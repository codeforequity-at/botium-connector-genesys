require('dotenv').config()
const nock = require('nock')
const assert = require('chai').assert
const { importHandler, detectNlpData, getBotFlows, getBotFlowsConfiguration } = require('../../src/intents')
const { UrlsByRegion, Capabilities } = require('../../src/constants')
const _ = require('lodash')
const { getAccessToken } = require('../../src/util')
const caps = {
  GENESYS_AWS_REGION: 'us-east-1',
  GENESYS_CLIENT_ID: '5305cdc8-5ef9-49b9-8cbe-95e87bd3c42d',
  GENESYS_CLIENT_SECRET: 'vL9kEoHLCb6AWmby5xpHrbAKviL-Lzu6WCiBUZTtmAU',
  GENESYS_INBOUND_MESSAGE_FLOW_NAME: 'InboundFlowMock',
  GENESYS_INBOUND_FLOW_TYPE: 'INBOUNDSHORTMESSAGE'
}

const mockGenesysApi = ({ auth = true, flowList = true, inboundMessageFlow = true, botFlow = true, nluDomain = true, emptyBotFlows = false }) => {
  const authEndpoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.auth`)
  const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)

  let authStatus = 200
  let authData = {
    access_token: 'AccessToken123',
    token_type: 'bearer',
    expires_in: 86399
  }
  if (!auth) {
    authStatus = 400
    authData = {}
  }

  nock(authEndpoint)
    .post('/oauth/token', body => true, null)
    .reply(authStatus, authData)
    .persist()

  const inboundMessageId = 'inboundMessage01'
  let flowListStatus = 200
  let flowListData = {
    entities: [
      {
        id: inboundMessageId,
        type: 'INBOUNDSHORTMESSAGE'
      }
    ]
  }
  if (!flowList) {
    flowListStatus = 400
    flowListData = {}
  }

  nock(apiEndPoint)
    .get('/api/v2/flows')
    .query({ name: caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME, type: caps.GENESYS_INBOUND_FLOW_TYPE })
    .reply(flowListStatus, flowListData)
    .persist()

  const digitalBotFlowId = 'digitalBotFlow01'
  let inboundMessageFlowStatus = 200
  let inboundMessageFlowData = {
    manifest: {
      digitalBotFlow: [
        {
          id: digitalBotFlowId,
          name: digitalBotFlowId
        }
      ]
    }
  }
  if (emptyBotFlows) {
    inboundMessageFlowData = {
      manifest: {}
    }
  }
  if (!inboundMessageFlow) {
    inboundMessageFlowStatus = 400
    inboundMessageFlowData = {}
  }
  nock(apiEndPoint)
    .get(`/api/v2/flows/${inboundMessageId}/latestconfiguration`)
    .reply(inboundMessageFlowStatus, inboundMessageFlowData)
    .persist()

  const nluDomainId = 'nluDomainId01'
  const nluDomainVersionId = 'nluDomainVersionId01'
  let botFlowStatus = 200
  let botFlowData = {
    id: digitalBotFlowId,
    name: digitalBotFlowId,
    botFlowSettings: {
      nluDomainId,
      nluDomainVersionId
    }
  }
  if (!botFlow) {
    botFlowStatus = 400
    botFlowData = {}
  }
  nock(apiEndPoint)
    .get(`/api/v2/flows/${digitalBotFlowId}/latestconfiguration`)
    .reply(botFlowStatus, botFlowData)
    .persist()

  const intentName = 'intent01'
  let nluDomainStatus = 200
  let nluDomainData = {
    language: 'en_us',
    intents: [
      {
        name: intentName,
        utterances: [
          {
            segments: [
              {
                text: 'Tell me a joke'
              }
            ]
          },
          {
            segments: [
              {
                text: 'Tell me '
              },
              {
                text: '2',
                entity: {
                  name: 'NumberOfJokes'
                }
              },
              {
                text: ' jokes'
              }
            ]
          }
        ]
      }
    ]
  }
  if (!nluDomain) {
    nluDomainStatus = 400
    nluDomainData = {}
  }
  nock(apiEndPoint)
    .get(`/api/v2/languageunderstanding/domains/${nluDomainId}/versions/${nluDomainVersionId}?includeUtterances=true`)
    .reply(nluDomainStatus, nluDomainData)
    .persist()
}

const mockFlowList = ({ apiEndPoint, flowName, flowType, flowId }) => {
  nock(apiEndPoint)
    .get('/api/v2/flows')
    .query({ name: flowName, type: flowType })
    .reply(200, {
      entities: [
        {
          id: flowId,
          type: flowType
        }
      ]
    })
}

const mockFlowConfiguration = ({ apiEndPoint, flowId, manifest }) => {
  nock(apiEndPoint)
    .get(`/api/v2/flows/${flowId}/latestconfiguration`)
    .reply(200, { manifest })
}

describe('importhandler', function () {
  before(async function () {
    Object.keys(process.env).filter(e => e.startsWith('BOTIUM_')).forEach((element) => {
      const elementToMerge = element.replace(/^BOTIUM_/, '')
      caps[elementToMerge] = process.env[element]
    })
  })

  afterEach(async function () {
    nock.cleanAll()
  })

  it('should successfully download intents', async function () {
    mockGenesysApi({})
    const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], caps[Capabilities.GENESYS_CLIENT_ID], caps[Capabilities.GENESYS_CLIENT_SECRET])
    assert.equal(accessToken, 'AccessToken123')

    const result = await importHandler({ caps })
    assert.equal(result.convos.length, 0)
    assert.isAbove(result.utterances.length, 0)
    const utterance = result.utterances[0]
    assert.equal(utterance.name, 'intent01')
    assert.isTrue(utterance.utterances.includes('Tell me a joke'))
  })

  it('should find direct bot flows', async function () {
    const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)
    mockFlowList({
      apiEndPoint,
      flowName: caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME,
      flowType: caps.GENESYS_INBOUND_FLOW_TYPE,
      flowId: 'inboundMessage01'
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'inboundMessage01',
      manifest: {
        digitalBotFlow: [
          {
            id: 'digitalBotFlow01',
            name: 'Digital Bot Flow'
          }
        ],
        botFlow: [
          {
            id: 'botFlow01',
            name: 'Bot Flow'
          }
        ]
      }
    })

    const result = await getBotFlows(caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME, apiEndPoint, 'AccessToken123', caps.GENESYS_INBOUND_FLOW_TYPE)
    assert.deepEqual(result, [
      {
        id: 'digitalBotFlow01',
        name: 'Digital Bot Flow'
      },
      {
        id: 'botFlow01',
        name: 'Bot Flow'
      }
    ])
  })

  it('should find bot flows in referenced inbound call flows', async function () {
    const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)
    const flowName = 'InboundCallFlowMock'
    const flowType = 'INBOUNDCALL'
    mockFlowList({
      apiEndPoint,
      flowName,
      flowType,
      flowId: 'inboundCall01'
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'inboundCall01',
      manifest: {
        inboundCallFlow: [
          {
            id: 'intentSelectionFlow01',
            name: 'Intent Selection Flow'
          }
        ]
      }
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'intentSelectionFlow01',
      manifest: {
        botFlow: [
          {
            id: 'voiceBotFlow01',
            name: 'Voice Bot Flow'
          }
        ]
      }
    })

    const result = await getBotFlows(flowName, apiEndPoint, 'AccessToken123', flowType)
    assert.deepEqual(result, [
      {
        id: 'voiceBotFlow01',
        name: 'Voice Bot Flow'
      }
    ])
  })

  it('should find bot flows in referenced common module flows', async function () {
    const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)
    mockFlowList({
      apiEndPoint,
      flowName: caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME,
      flowType: caps.GENESYS_INBOUND_FLOW_TYPE,
      flowId: 'inboundMessage01'
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'inboundMessage01',
      manifest: {
        commonModuleFlow: [
          {
            id: 'commonModuleFlow01',
            name: 'Common Module Flow'
          }
        ]
      }
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'commonModuleFlow01',
      manifest: {
        digitalBotFlow: [
          {
            id: 'digitalBotFlow01',
            name: 'Digital Bot Flow'
          }
        ]
      }
    })

    const result = await getBotFlows(caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME, apiEndPoint, 'AccessToken123', caps.GENESYS_INBOUND_FLOW_TYPE)
    assert.deepEqual(result, [
      {
        id: 'digitalBotFlow01',
        name: 'Digital Bot Flow'
      }
    ])
  })

  it('should avoid cycles and dedupe bot flows', async function () {
    const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)
    mockFlowList({
      apiEndPoint,
      flowName: caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME,
      flowType: caps.GENESYS_INBOUND_FLOW_TYPE,
      flowId: 'inboundMessage01'
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'inboundMessage01',
      manifest: {
        inboundShortMessageFlow: [
          {
            id: 'childFlow01',
            name: 'Child Flow 1'
          },
          {
            id: 'childFlow02',
            name: 'Child Flow 2'
          }
        ],
        commonModuleFlow: [
          {
            id: 'childFlow01',
            name: 'Child Flow 1'
          }
        ]
      }
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'childFlow01',
      manifest: {
        botFlow: [
          {
            id: 'botFlow01',
            name: 'Bot Flow'
          }
        ],
        inboundShortMessageFlow: [
          {
            id: 'inboundMessage01',
            name: 'Inbound Message Flow'
          }
        ]
      }
    })
    mockFlowConfiguration({
      apiEndPoint,
      flowId: 'childFlow02',
      manifest: {
        botFlow: [
          {
            id: 'botFlow01',
            name: 'Bot Flow'
          }
        ],
        inboundShortMessageFlow: [
          {
            id: 'childFlow01',
            name: 'Child Flow 1'
          }
        ]
      }
    })

    const result = await getBotFlows(caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME, apiEndPoint, 'AccessToken123', caps.GENESYS_INBOUND_FLOW_TYPE)
    assert.deepEqual(result, [
      {
        id: 'botFlow01',
        name: 'Bot Flow'
      }
    ])
  })

  it('should fail at access token', async function () {
    mockGenesysApi({ auth: false })
    try {
      await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], caps[Capabilities.GENESYS_CLIENT_ID], caps[Capabilities.GENESYS_CLIENT_SECRET])
      assert.fail('it should have failed')
    } catch (err) {
      assert.equal(err.message, 'Failed to get access token: HTTP error! Status: 400, Message: {}')
    }
  })

  it('should fail at flow list', async function () {
    mockGenesysApi({ flowList: false })
    const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], caps[Capabilities.GENESYS_CLIENT_ID], caps[Capabilities.GENESYS_CLIENT_SECRET])
    assert.equal(accessToken, 'AccessToken123')
    try {
      await importHandler({ caps })
      assert.fail('it should have failed')
    } catch (err) {
      assert.equal(err.message, 'Import failed: Request by name for inbound message flow: HTTP error! Status: 400, Message: {}')
    }
  })

  it('should fail at inbound Message Flow', async function () {
    mockGenesysApi({ inboundMessageFlow: false })
    const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], caps[Capabilities.GENESYS_CLIENT_ID], caps[Capabilities.GENESYS_CLIENT_SECRET])
    assert.equal(accessToken, 'AccessToken123')
    try {
      await importHandler({ caps })
      assert.fail('it should have failed')
    } catch (err) {
      assert.equal(err.message, 'Import failed: Request the latest configuration for botflow failed: HTTP error! Status: 400, Message: {}')
    }
  })

  it('should fail when inbound flow has no bot flows', async function () {
    mockGenesysApi({ emptyBotFlows: true })
    const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], caps[Capabilities.GENESYS_CLIENT_ID], caps[Capabilities.GENESYS_CLIENT_SECRET])
    assert.equal(accessToken, 'AccessToken123')
    try {
      await getBotFlowsConfiguration(caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME, _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`), accessToken, caps.GENESYS_INBOUND_FLOW_TYPE)
      assert.fail('it should have failed')
    } catch (err) {
      assert.equal(err.message, `No bot flows found in inbound flow '${caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME}' and type '${caps.GENESYS_INBOUND_FLOW_TYPE}'`)
    }
  })

  it('should fail nlp detection when no bot flow configuration is available', async function () {
    try {
      await detectNlpData({
        botFlowsConfiguration: [],
        apiEndPoint: 'https://api.example.com',
        accessToken: 'AccessToken123',
        messageText: 'Tell me a joke'
      })
      assert.fail('it should have failed')
    } catch (err) {
      assert.equal(err.message, 'No bot flow configuration available for NLP detection')
    }
  })
})

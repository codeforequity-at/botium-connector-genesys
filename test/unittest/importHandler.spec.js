require('dotenv').config()
const nock = require('nock')
const assert = require('chai').assert
const { importHandler } = require('../../src/intents')
const { UrlsByRegion, Capabilities } = require('../../src/constants')
const _ = require('lodash')
const { getAccessToken } = require('../../src/util')
const caps = {
  GENESYS_AWS_REGION: 'us-east-1',
  GENESYS_CLIENT_ID: '5305cdc8-5ef9-49b9-8cbe-95e87bd3c42d',
  GENESYS_CLIENT_SECRET: 'vL9kEoHLCb6AWmby5xpHrbAKviL-Lzu6WCiBUZTtmAU'
}

const mockGenesysApi = ({ auth = true, flowList = true, inboundMessageFlow = true, botFlow = true, nluDomain = true }) => {
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
})

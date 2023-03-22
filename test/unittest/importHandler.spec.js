require('dotenv').config()
const axios = require('axios')
const MockAdapter = require('axios-mock-adapter')
const assert = require('chai').assert
const { importHandler } = require('../../src/intents')
const { UrlsByRegion, Capabilities } = require('../../src/constants')
const _ = require('lodash')
const { getAccessToken } = require('../../src/util')
const caps = {}

describe('importhandler', function () {
  before(async function () {
    Object.keys(process.env).filter(e => e.startsWith('BOTIUM_')).forEach((element) => {
      const elementToMerge = element.replace(/^BOTIUM_/, '')
      caps[elementToMerge] = process.env[element]
    })

    const mock = new MockAdapter(axios)
    const authEndpoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.auth`)
    const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)
    mock.onPost(`${authEndpoint}/oauth/token`).reply(200, {
      access_token: 'AccessToken123',
      token_type: 'bearer',
      expires_in: 86399
    })
    const inboundMessageId = 'inboundMessage01'
    mock.onGet(`${apiEndPoint}/api/v2/flows`).reply(200, {
      entities: [
        {
          id: inboundMessageId,
          type: 'INBOUNDSHORTMESSAGE'
        }
      ]
    })
    const digitalBotFlowId = 'digitalBotFlow01'
    mock.onGet(`${apiEndPoint}/api/v2/flows/${inboundMessageId}/latestconfiguration`).reply(200, {
      manifest: {
        digitalBotFlow: [
          {
            id: digitalBotFlowId,
            name: digitalBotFlowId
          }
        ]
      }
    })
    const nluDomainId = 'nluDomainId01'
    const nluDomainVersionId = 'nluDomainVersionId01'
    mock.onGet(`${apiEndPoint}/api/v2/flows/${digitalBotFlowId}/latestconfiguration`).reply(200, {
      id: digitalBotFlowId,
      name: digitalBotFlowId,
      botFlowSettings: {
        nluDomainId,
        nluDomainVersionId
      }
    })
    const intentName = 'intent01'
    mock.onGet(`${apiEndPoint}/api/v2/languageunderstanding/domains/${nluDomainId}/versions/${nluDomainVersionId}`).reply(200, {
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
    })
  })
  it('should successfully download intents', async function () {
    const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], caps[Capabilities.GENESYS_CLIENT_ID], caps[Capabilities.GENESYS_CLIENT_SECRET])
    assert.equal(accessToken, 'AccessToken123')

    const result = await importHandler({ caps })
    assert.equal(result.convos.length, 0)
    assert.isAbove(result.utterances.length, 0)
    const utterance = result.utterances[0]
    assert.equal(utterance.name, 'digitalBotFlow01_intent01')
    assert.isTrue(utterance.utterances.includes('Tell me a joke'))
  }).timeout(10000)
})

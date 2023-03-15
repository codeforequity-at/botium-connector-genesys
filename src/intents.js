const debug = require('debug')('botium-connector-genesys-intents')
const axios = require('axios')
const slugify = require('slugify')
const { getAccessToken } = require('./util')
const { Capabilities, UrlsByRegion } = require('./constants')
const _ = require('lodash')

const axiosWithCustomError = async (options, msg) => {
  try {
    return axios(options)
  } catch (err) {
    throw new Error(`${msg}: ${err.message}`)
  }
}

const _updateUtterancesByBotFlow = async (apiEndPoint, accessToken, botFlowId, chatbotData, utterances, language) => {
  const reqOptionBotFlowConfig = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/flows/${botFlowId}/latestconfiguration`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request the latest configuration for botflow: ${JSON.stringify(reqOptionBotFlowConfig, null, 2)}`)
  const responseBotFlowConfig = await axiosWithCustomError(reqOptionBotFlowConfig, 'Request the latest configuration for botflow failed')

  const domainId = _.get(responseBotFlowConfig, 'data.botFlowSettings.nluDomainId')
  const domainVersionId = _.get(responseBotFlowConfig, 'data.botFlowSettings.nluDomainVersionId')
  const reqOptionNluDomain = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/languageunderstanding/domains/${domainId}/versions/${domainVersionId}`,
    params: {
      includeUtterances: true
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request the latest NLU domain version: ${JSON.stringify(reqOptionNluDomain, null, 2)}`)
  const responseNluDomain = await axiosWithCustomError(reqOptionNluDomain, ' Request the latest NLU domain version failed')

  if (!language || (language && responseNluDomain.data.language && responseNluDomain.data.language.toLowerCase() === language.toLowerCase())) {
    for (const intent of responseNluDomain.data.intents) {
      const intentName = `${slugify(responseBotFlowConfig.data.name)}_${slugify(intent.name)}`
      for (const utterance of intent.utterances) {
        const uttText = utterance.segments.reduce((acc, curr) => acc + curr.text, '').trim()
        if (!_.isEmpty(uttText)) {
          if (!utterances[intentName]) {
            utterances[intentName] = {
              name: intentName,
              utterances: [uttText]
            }
          } else {
            utterances[intentName].utterances.push(uttText)
          }
        }
      }
    }
    chatbotData.push(responseNluDomain.data)
  }
}

const _importIt = async ({ caps, inboundMessageFlowName, clientId, clientSecret, language }) => {
  const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], clientId || caps[Capabilities.GENESYS_CLIENT_ID], clientSecret || caps[Capabilities.GENESYS_CLIENT_SECRET])
  const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)

  const reqOptionInboundMessageFlow = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/flows`,
    params: {
      name: inboundMessageFlowName || caps[Capabilities.GENESYS_INBOUND_MESSAGE_FLOW_NAME]
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request by name for inbound message flow: ${JSON.stringify(reqOptionInboundMessageFlow, null, 2)}`)
  const responseInboundMessageFlow = await axiosWithCustomError(reqOptionInboundMessageFlow, 'Request by name for inbound message flow')
  const inboundMessageFlow = responseInboundMessageFlow.data.entities.find(e => e.type === 'INBOUNDSHORTMESSAGE')
  if (!inboundMessageFlow) {
    throw new Error(`Inbound Message flow not found by '${inboundMessageFlowName}' name`)
  }

  const reqOptionInboundMessageFlowConfig = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/flows/${inboundMessageFlow.id}/latestconfiguration`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request the latest configuration for botflow: ${JSON.stringify(reqOptionInboundMessageFlowConfig, null, 2)}`)
  const responseInboundMessageFlowConfig = await axiosWithCustomError(reqOptionInboundMessageFlowConfig, 'Request the latest configuration for botflow failed')

  const botFlowIds = []
  botFlowIds.push(...(_.get(responseInboundMessageFlowConfig, 'data.manifest.digitalBotFlow')
    ? _.get(responseInboundMessageFlowConfig, 'data.manifest.digitalBotFlow').map(bot => bot.id) : []))
  botFlowIds.push(...(_.get(responseInboundMessageFlowConfig, 'data.manifest.botFlow')
    ? _.get(responseInboundMessageFlowConfig, 'data.manifest.botFlow').map(bot => bot.id) : []))

  if (botFlowIds.length === 0) {
    return { chatbotData: {}, rawUtterances: {} }
  }
  const utterances = {}
  const chatbotData = []
  for (const botFlowId of botFlowIds) {
    await _updateUtterancesByBotFlow(apiEndPoint, accessToken, botFlowId, chatbotData, utterances, language)
  }

  return { chatbotData: chatbotData.length > 1 ? chatbotData : chatbotData[0], rawUtterances: utterances }
}

/**
 *
 * @param caps
 * @param buildconvos
 * @param inboundMessageFlowName
 * @param clientId
 * @param clientSecret
 * @param language - in "en-us" format, or null for all
 * @returns {Promise<{utterances: *, convos: *}>}
 */
const importGenesysBotFlowIntents = async ({ caps, buildconvos, inboundMessageFlowName, clientId, clientSecret, language }) => {
  try {
    const downloadResult = await _importIt({ caps, inboundMessageFlowName, clientId, clientSecret, language })
    const utterances = Object.values(downloadResult.rawUtterances)
    const convos = []
    if (buildconvos) {
      for (const utterance of utterances) {
        const convo = {
          header: {
            name: utterance.name
          },
          conversation: [
            {
              sender: 'me',
              messageText: utterance.name
            },
            {
              sender: 'bot',
              asserters: [
                {
                  name: 'INTENT',
                  args: [utterance.name]
                }
              ]
            }
          ]
        }
        convos.push(convo)
      }
    }

    return {
      convos,
      utterances
    }
  } catch (err) {
    throw new Error(`Import failed: ${err.message}`)
  }
}

module.exports = {
  importHandler: ({ caps, buildconvos, inboundMessageFlowName, clientId, clientSecret, language, ...rest } = {}) => importGenesysBotFlowIntents({
    caps,
    buildconvos,
    inboundMessageFlowName,
    clientId,
    clientSecret,
    language,
    ...rest
  }),
  importArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    buildconvos: {
      describe: 'Build convo files for intent assertions (otherwise, just write utterances files)',
      type: 'boolean',
      default: false
    },
    inboundMessageFlowName: {
      describe: 'Inbound Message flow name from genesys architect view',
      type: 'string'
    },
    clientId: {
      describe: 'Client ID from Genesys OAuth integration',
      type: 'string'
    },
    clientSecret: {
      describe: 'Client Secret from Genesys OAuth integration',
      type: 'string'
    },
    language: {
      describe: 'Language (like en-us)',
      type: 'string'
    }
  }
}
const debug = require('debug')('botium-connector-genesys-intents')
const axios = require('axios')
const { getAccessToken } = require('./util')
const { Capabilities, UrlsByRegion } = require('./constants')
const _ = require('lodash')
const INCOMPREHENSION_INTENT = 'None'
const INCOMPREHENSION_INTENT_STRUCT = {
  name: INCOMPREHENSION_INTENT,
  incomprehension: true,
  confidence: 1
}

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
      const intentName = intent.name
      for (const utterance of intent.utterances) {
        const uttText = utterance.segments.reduce((acc, curr) => acc + curr.text, '').trim()
        if (!_.isEmpty(uttText)) {
          if (!utterances[intentName]) {
            utterances[intentName] = {
              name: intentName,
              utterances: [uttText]
            }
          } else {
            if (!utterances[intentName].utterances.includes(uttText)) {
              utterances[intentName].utterances.push(uttText)
            }
          }
        }
      }
    }
    chatbotData.push(responseNluDomain.data)
  }
}

const _importIt = async ({ caps, inboundMessageFlowName, botFlowId, clientId, clientSecret, language }) => {
  const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], clientId || caps[Capabilities.GENESYS_CLIENT_ID], clientSecret || caps[Capabilities.GENESYS_CLIENT_SECRET])
  const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)

  const utterances = {}
  const chatbotData = []
  if (botFlowId) {
    await _updateUtterancesByBotFlow(apiEndPoint, accessToken, botFlowId, chatbotData, utterances, language)
  } else {
    const botFlows = await getBotFlows(inboundMessageFlowName || caps[Capabilities.GENESYS_INBOUND_MESSAGE_FLOW_NAME], apiEndPoint, accessToken)
    if (botFlows.length === 0) {
      return { chatbotData: {}, rawUtterances: {} }
    }
    for (const botFlow of botFlows) {
      await _updateUtterancesByBotFlow(apiEndPoint, accessToken, botFlow.id, chatbotData, utterances, language)
    }
  }

  return { chatbotData: chatbotData.length > 1 ? chatbotData : chatbotData[0], rawUtterances: utterances }
}

/**
 *
 * @param inboundMessageFlowName
 * @param apiEndPoint
 * @param accessToken
 * @returns {Promise<[]>}
 */
const getBotFlows = async (inboundMessageFlowName, apiEndPoint, accessToken) => {
  const reqOptionInboundMessageFlow = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/flows`,
    params: {
      name: inboundMessageFlowName
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

  const botFlows = []
  botFlows.push(...(_.get(responseInboundMessageFlowConfig, 'data.manifest.digitalBotFlow')
    ? _.get(responseInboundMessageFlowConfig, 'data.manifest.digitalBotFlow').map(bot => ({ id: bot.id, name: bot.name })) : []))
  botFlows.push(...(_.get(responseInboundMessageFlowConfig, 'data.manifest.botFlow')
    ? _.get(responseInboundMessageFlowConfig, 'data.manifest.botFlow').map(bot => ({ id: bot.id, name: bot.name })) : []))

  return botFlows
}

/**
 *
 * @param caps
 * @param buildconvos
 * @param inboundMessageFlowName
 * @param botFlowId
 * @param clientId
 * @param clientSecret
 * @param language - in "en-us" format, or null for all
 * @returns {Promise<{utterances: *, convos: *}>}
 */
const importGenesysBotFlowIntents = async ({ caps, buildconvos, inboundMessageFlowName, botFlowId, clientId, clientSecret, language }) => {
  try {
    const downloadResult = await _importIt({ caps, inboundMessageFlowName, botFlowId, clientId, clientSecret, language })
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

const getBotFlowsConfiguration = async (inboundMessageFlowName, apiEndPoint, accessToken) => {
  const botFlows = await getBotFlows(inboundMessageFlowName, apiEndPoint, accessToken)
  const botFlowsConfiguration = []
  for (const botFlow of botFlows) {
    const reqOptionBotFlowConfig = {
      method: 'get',
      url: `${apiEndPoint}/api/v2/flows/${botFlow.id}/latestconfiguration`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
    debug(`Request the latest configuration for botflow: ${JSON.stringify(reqOptionBotFlowConfig, null, 2)}`)
    const responseBotFlowConfig = await axiosWithCustomError(reqOptionBotFlowConfig, 'Request the latest configuration for botflow failed')
    botFlowsConfiguration.push({
      id: botFlow.id,
      name: responseBotFlowConfig.data.name,
      domainId: _.get(responseBotFlowConfig, 'data.botFlowSettings.nluDomainId'),
      domainVersionId: _.get(responseBotFlowConfig, 'data.botFlowSettings.nluDomainVersionId')
    })
  }
  return botFlowsConfiguration
}

const detectNlpData = async (botFlowsConfiguration, apiEndPoint, accessToken, messageText) => {
  let intents = []
  for (const botFlowConf of botFlowsConfiguration) {
    const reqOptionDetectIntentConfig = {
      method: 'post',
      url: `${apiEndPoint}/api/v2/languageunderstanding/domains/${botFlowConf.domainId}/versions/${botFlowConf.domainVersionId}/detect`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({ input: { text: messageText } })
    }
    debug(`Request for detect intent: ${JSON.stringify(reqOptionDetectIntentConfig, null, 2)}`)
    const responseDetectIntent = await axiosWithCustomError(reqOptionDetectIntentConfig, 'Request for detect intent failed')

    const candidateIntents = responseDetectIntent.data.output.intents
    if (intents.length === 0 || intents[0].name === 'None') {
      intents = candidateIntents
      continue
    }

    const candidateIntent = candidateIntents[0]
    const mostConfidentIntent = intents[0]
    if (candidateIntent.name !== 'None' && mostConfidentIntent.probability < candidateIntent.probability) {
      intents = candidateIntents
    }
  }

  const nlp = {}
  if (intents.length > 0) {
    if (intents[0].name === 'None') {
      nlp.intent = INCOMPREHENSION_INTENT_STRUCT
    } else {
      nlp.intent = { name: intents[0].name, confidence: intents[0].probability }
      nlp.intents = intents.length > 1 && intents.slice(1).map((intent) => {
        return { name: intent.name, confidence: intent.probability }
      })
      nlp.entities = intents[0].entities.length > 0 ? intents[0].entities.map(e => ({
        name: e.name,
        value: e.value.resolved,
        confidence: e.probability
      })) : []
    }
  }
  return nlp
}

module.exports = {
  importHandler: ({ caps, buildconvos, inboundMessageFlowName, botFlowId, clientId, clientSecret, language, ...rest } = {}) => importGenesysBotFlowIntents({
    caps,
    buildconvos,
    inboundMessageFlowName,
    botFlowId,
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
  },
  getBotFlowsConfiguration,
  detectNlpData,
  getBotFlows
}

const debug = require('debug')('botium-connector-genesys-intents')
const { getAccessToken } = require('./util')
const { Capabilities, UrlsByRegion } = require('./constants')
const _ = require('lodash')
const INCOMPREHENSION_INTENT = 'None'
const INCOMPREHENSION_INTENT_STRUCT = {
  name: INCOMPREHENSION_INTENT,
  incomprehension: true,
  confidence: 1
}

const fetchWithCustomError = async (options, msg) => {
  try {
    const reponse = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body
    })

    if (!reponse.ok) {
      const errorDetails = await reponse.text()
      throw new Error(`HTTP error! Status: ${reponse.status}, Message: ${errorDetails}`)
    }
    return reponse.json()
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
  const responseBotFlowConfig = await fetchWithCustomError(reqOptionBotFlowConfig, 'Request the latest configuration for botflow failed')

  const domainId = _.get(responseBotFlowConfig, 'botFlowSettings.nluDomainId')
  const domainVersionId = _.get(responseBotFlowConfig, 'botFlowSettings.nluDomainVersionId')
  const reqOptionNluDomain = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/languageunderstanding/domains/${domainId}/versions/${domainVersionId}?includeUtterances=true`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request the latest NLU domain version: ${JSON.stringify(reqOptionNluDomain, null, 2)}`)
  const responseNluDomain = await fetchWithCustomError(reqOptionNluDomain, ' Request the latest NLU domain version failed')

  if (!language || (language && responseNluDomain.language && responseNluDomain.language.toLowerCase() === language.toLowerCase())) {
    for (const intent of responseNluDomain.intents) {
      if (_.isArray(intent.utterances)) {
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
    }
    chatbotData.push(responseNluDomain)
  }

  const knowledgeBaseId = _.get(responseBotFlowConfig, 'knowledgeSettings.knowledgeBaseId')
  if (knowledgeBaseId) {
    const reqOptionKnowledgeBase = {
      method: 'get',
      url: `${apiEndPoint}/api/v2/knowledge/knowledgebases/${knowledgeBaseId}/documents`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
    debug(`Request knowledge base: ${JSON.stringify(reqOptionKnowledgeBase, null, 2)}`)
    const responseKnowledgeBase = await fetchWithCustomError(reqOptionKnowledgeBase, ' Request knowledge base failed')

    const getAllDocumentsRecursive = async (responseKnowledgeBase) => {
      for (const entity of responseKnowledgeBase.entities) {
        if (_.isArray(entity.alternatives)) {
          const intentName = entity.title
          for (const alternative of entity.alternatives) {
            const uttText = alternative.phrase
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
      }
      chatbotData.push(responseKnowledgeBase)

      if (responseKnowledgeBase.nextUri) {
        const reqOptionNextKnowledgeBase = {
          method: 'get',
          url: `${apiEndPoint}${responseKnowledgeBase.nextUri}`,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
        debug(`Request knowledge base: ${JSON.stringify(reqOptionNextKnowledgeBase, null, 2)}`)
        const responseNextKnowledgeBase = await fetchWithCustomError(reqOptionNextKnowledgeBase, ' Request knowledge base failed')
        await getAllDocumentsRecursive(responseNextKnowledgeBase)
      }
    }

    await getAllDocumentsRecursive(responseKnowledgeBase)
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
    url: `${apiEndPoint}/api/v2/flows${inboundMessageFlowName ? `?name=${inboundMessageFlowName}` : ''}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request by name for inbound message flow: ${JSON.stringify(reqOptionInboundMessageFlow, null, 2)}`)
  const responseInboundMessageFlow = await fetchWithCustomError(reqOptionInboundMessageFlow, 'Request by name for inbound message flow')
  const inboundMessageFlow = responseInboundMessageFlow.entities.find(e => e.type === 'INBOUNDSHORTMESSAGE')
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
  const responseInboundMessageFlowConfig = await fetchWithCustomError(reqOptionInboundMessageFlowConfig, 'Request the latest configuration for botflow failed')

  const botFlows = []
  botFlows.push(...(_.get(responseInboundMessageFlowConfig, 'manifest.digitalBotFlow')
    ? _.get(responseInboundMessageFlowConfig, 'manifest.digitalBotFlow').map(bot => ({ id: bot.id, name: bot.name })) : []))
  botFlows.push(...(_.get(responseInboundMessageFlowConfig, 'manifest.botFlow')
    ? _.get(responseInboundMessageFlowConfig, 'manifest.botFlow').map(bot => ({ id: bot.id, name: bot.name })) : []))

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
    const responseBotFlowConfig = await fetchWithCustomError(reqOptionBotFlowConfig, 'Request the latest configuration for botflow failed')

    botFlowsConfiguration.push({
      id: botFlow.id,
      name: responseBotFlowConfig.name,
      domainId: _.get(responseBotFlowConfig, 'botFlowSettings.nluDomainId'),
      domainVersionId: _.get(responseBotFlowConfig, 'botFlowSettings.nluDomainVersionId'),
      knowledgeBaseId: _.get(responseBotFlowConfig, 'knowledgeSettings.knowledgeBaseId'),
      maxNumOfAnswersReturned: _.get(responseBotFlowConfig, 'knowledgeSettings.maxNumOfAnswersReturned.text') || '3',
      responseBias: _.get(responseBotFlowConfig, 'knowledgeSettings.responseBias.text') || 'neutral'
    })
  }
  return botFlowsConfiguration
}

const detectIntentInDomain = async (botFlowConf, apiEndPoint, accessToken, messageText, mostConfidentIntentSoFar) => {
  const reqOptionDetectIntentConfig = {
    method: 'post',
    url: `${apiEndPoint}/api/v2/languageunderstanding/domains/${botFlowConf.domainId}/versions/${botFlowConf.domainVersionId}/detect`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input: { text: messageText } })
  }
  debug(`Request for detect intent: ${JSON.stringify(reqOptionDetectIntentConfig, null, 2)}`)
  const responseDetectIntent = await fetchWithCustomError(reqOptionDetectIntentConfig, 'Request for detect intent failed')

  const candidateIntents = responseDetectIntent.output.intents
  if (!mostConfidentIntentSoFar || mostConfidentIntentSoFar.name === 'None') {
    return candidateIntents
  }

  const candidateIntent = candidateIntents[0]
  if (candidateIntent && candidateIntent.name !== 'None' && mostConfidentIntentSoFar.probability < candidateIntent.probability) {
    return candidateIntents
  }
  return []
}

const searchInKnowledge = async (botFlowConf, apiEndPoint, accessToken, messageText, mostConfidentIntentSoFar) => {
  const reqOptionSearchKnowledgeConfig = {
    method: 'post',
    url: `${apiEndPoint}/api/v2/knowledge/knowledgebases/${botFlowConf.knowledgeBaseId}/documents/search`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: messageText,
      pageSize: botFlowConf.maxNumOfAnswersReturned,
      sortBy: 'ConfidenceScore'
    })
  }
  debug(`Request for search knowledge: ${JSON.stringify(reqOptionSearchKnowledgeConfig, null, 2)}`)
  const responseSearchKnowledge = await fetchWithCustomError(reqOptionSearchKnowledgeConfig, 'Request for search knowledge failed')

  const candidateIntents = responseSearchKnowledge.results.map(knowledge => (
    {
      probability: knowledge.confidence,
      name: knowledge.document.title
    }
  ))
  if (!mostConfidentIntentSoFar || mostConfidentIntentSoFar.name === 'None') {
    return candidateIntents
  }

  const candidateIntent = candidateIntents[0]
  if (candidateIntent && candidateIntent.name !== 'None' && mostConfidentIntentSoFar.probability < candidateIntent.probability) {
    return candidateIntents
  }
  return []
}

const detectNlpData = async ({ botFlowsConfiguration, apiEndPoint, accessToken, messageText, messageId, botFlowNameField }) => {
  let botFlowName
  if (messageId && botFlowNameField) {
    const reqOptionMessageDetails = {
      method: 'get',
      url: `${apiEndPoint}/api/v2/conversations/messages/${messageId}/details`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
    debug(`Request for message details: ${JSON.stringify(reqOptionMessageDetails, null, 2)}`)
    const responseMessageDetails = await fetchWithCustomError(reqOptionMessageDetails, 'Request for message details failed')

    const reqOptionConversation = {
      method: 'get',
      url: `${apiEndPoint}/api/v2/conversations/${responseMessageDetails.conversationId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
    debug(`Request for conversation: ${JSON.stringify(reqOptionConversation, null, 2)}`)
    const responseConversation = await fetchWithCustomError(reqOptionConversation, 'Request for conversation failed')

    const participant = _.find(responseConversation.participants, p => !_.isNil(p.attributes[botFlowNameField]))
    botFlowName = participant && participant.attributes[botFlowNameField]
  }

  let intents = []
  const detectNlpDataByFlow = async (botFlowConf) => {
    if (botFlowConf.knowledgeBaseId && messageText && messageText.length >= 3) {
      const responseBias = botFlowConf.responseBias
      if (responseBias === 'intents') {
        const detectedIntents = await detectIntentInDomain(botFlowConf, apiEndPoint, accessToken, messageText, intents[0])
        if (detectedIntents.length > 0) {
          intents = detectedIntents
        }
        const foundIntents = await searchInKnowledge(botFlowConf, apiEndPoint, accessToken, messageText, intents[0])
        if (foundIntents.length > 0) {
          intents = foundIntents
        }
      } else {
        // The responseBias either 'knowledge' or 'neutral'. In these cases knowledge has priority
        const foundIntents = await searchInKnowledge(botFlowConf, apiEndPoint, accessToken, messageText, intents[0])
        if (foundIntents.length > 0) {
          intents = foundIntents
        }
        const detectedIntents = await detectIntentInDomain(botFlowConf, apiEndPoint, accessToken, messageText, intents[0])
        if (detectedIntents.length > 0) {
          intents = detectedIntents
        }
      }
    } else {
      const detectedIntents = await detectIntentInDomain(botFlowConf, apiEndPoint, accessToken, messageText, intents[0])
      if (detectedIntents.length > 0) {
        intents = detectedIntents
      }
    }
  }

  if (botFlowName && _.some(botFlowsConfiguration, bfConfig => bfConfig.name === botFlowName)) {
    await detectNlpDataByFlow(_.find(botFlowsConfiguration, bfConfig => bfConfig.name === botFlowName))
  } else {
    for (const botFlowConf of botFlowsConfiguration) {
      await detectNlpDataByFlow(botFlowConf)
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
      nlp.entities = intents[0].entities && intents[0].entities.length > 0 ? intents[0].entities.map(e => ({
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

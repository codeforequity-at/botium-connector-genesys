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
const BOT_FLOW_MANIFEST_KEYS = ['digitalBotFlow', 'botFlow']
const FLOW_REFERENCE_MANIFEST_KEYS = [
  'inboundCallFlow',
  'inboundShortMessageFlow',
  'commonModuleFlow',
  'inQueueCallFlow',
  'inQueueShortMessageFlow',
  'inboundEmailFlow',
  'inQueueEmailFlow',
  'secureCallFlow'
]
const MAX_FLOW_REFERENCE_DEPTH = 10

const botFlowNames = (botFlows) => (_.isArray(botFlows) ? botFlows.map(botFlow => botFlow.name || botFlow.id).join(', ') : '')

const normalizeLanguage = (language) => {
  if (!language) {
    return null
  }
  return language.toString().trim().toLowerCase().replace(/_/g, '-')
}

/**
 * All languages an NLU domain version can be queried for: its own language plus the languages of
 * the sibling versions listed in languageVersions.
 */
const supportedLanguages = (domainVersion) => {
  const languages = []
  const addLanguage = (language) => {
    const normalized = normalizeLanguage(language)
    if (normalized && !languages.includes(normalized)) {
      languages.push(normalized)
    }
  }
  addLanguage(_.get(domainVersion, 'language'))
  Object.keys(_.get(domainVersion, 'languageVersions') || {}).forEach(language => addLanguage(language))
  return languages
}

/**
 * Genesys keeps one NLU domain version per language and maps them in languageVersions. Returns the
 * version id serving the requested language, or null when the language is not available.
 */
const resolveNluDomainVersionId = ({ domainVersion, domainVersionId, language }) => {
  const requestedLanguage = normalizeLanguage(language)
  if (!requestedLanguage) {
    return domainVersionId
  }

  const defaultLanguage = normalizeLanguage(_.get(domainVersion, 'language'))
  if (defaultLanguage === requestedLanguage) {
    return domainVersionId
  }

  const languageVersions = _.get(domainVersion, 'languageVersions') || {}
  const exactMatch = Object.keys(languageVersions).find(key => normalizeLanguage(key) === requestedLanguage)
  if (exactMatch) {
    return languageVersions[exactMatch]
  }

  // Genesys expects full locales like "es-es", accept a bare "es" as well
  const baseLanguage = requestedLanguage.split('-')[0]
  if (defaultLanguage && defaultLanguage.split('-')[0] === baseLanguage) {
    return domainVersionId
  }
  const baseMatch = Object.keys(languageVersions).find(key => normalizeLanguage(key).split('-')[0] === baseLanguage)
  if (baseMatch) {
    return languageVersions[baseMatch]
  }

  return null
}

const supportsLanguage = (botFlowConf, requestedLanguage) => {
  if (!requestedLanguage) {
    return true
  }
  const languages = _.get(botFlowConf, 'supportedLanguages')
  // unknown for bot flows without an NLU domain, treated as supported to keep them in the detection
  if (!_.isArray(languages) || languages.length === 0) {
    return true
  }
  return languages.includes(requestedLanguage)
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

const fetchLatestFlowConfiguration = async (apiEndPoint, accessToken, flowId) => {
  const reqOptionFlowConfig = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/flows/${flowId}/latestconfiguration`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request the latest configuration for flow: ${JSON.stringify(reqOptionFlowConfig, null, 2)}`)
  return fetchWithCustomError(reqOptionFlowConfig, 'Request the latest configuration for botflow failed')
}

const fetchNluDomainVersion = async (apiEndPoint, accessToken, domainId, domainVersionId, includeUtterances) => {
  const reqOptionNluDomain = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/languageunderstanding/domains/${domainId}/versions/${domainVersionId}${includeUtterances ? '?includeUtterances=true' : ''}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request the latest NLU domain version: ${JSON.stringify(reqOptionNluDomain, null, 2)}`)
  return fetchWithCustomError(reqOptionNluDomain, ' Request the latest NLU domain version failed')
}

const collectBotFlowsFromManifest = (manifest) => BOT_FLOW_MANIFEST_KEYS.reduce((botFlows, manifestKey) => {
  const manifestBotFlows = _.get(manifest, manifestKey)
  if (_.isArray(manifestBotFlows)) {
    botFlows.push(...manifestBotFlows
      .filter(bot => bot.id)
      .map(bot => ({ id: bot.id, name: bot.name })))
  }
  return botFlows
}, [])

const collectBotFlowsRecursive = async ({ apiEndPoint, accessToken, flowId, flowName, depth, visitedFlowIds, botFlowsById }) => {
  if (!flowId) {
    debug(`Skipping referenced flow without id at depth ${depth}`)
    return
  }
  if (visitedFlowIds.has(flowId)) {
    debug(`Skipping already visited flow '${flowName || flowId}' (${flowId})`)
    return
  }
  if (depth > MAX_FLOW_REFERENCE_DEPTH) {
    debug(`Skipping flow '${flowName || flowId}' (${flowId}) because maximum flow reference depth ${MAX_FLOW_REFERENCE_DEPTH} was reached`)
    return
  }

  visitedFlowIds.add(flowId)
  debug(`Inspecting flow '${flowName || flowId}' (${flowId}) at reference depth ${depth}`)
  const responseFlowConfig = await fetchLatestFlowConfiguration(apiEndPoint, accessToken, flowId)
  const manifest = _.get(responseFlowConfig, 'manifest', {})

  const botFlows = collectBotFlowsFromManifest(manifest)
  for (const botFlow of botFlows) {
    if (!botFlowsById.has(botFlow.id)) {
      botFlowsById.set(botFlow.id, botFlow)
      debug(`Found bot flow '${botFlow.name || botFlow.id}' (${botFlow.id}) in flow '${flowName || flowId}'`)
    } else {
      debug(`Skipping duplicate bot flow '${botFlow.name || botFlow.id}' (${botFlow.id})`)
    }
  }

  for (const manifestKey of FLOW_REFERENCE_MANIFEST_KEYS) {
    const referencedFlows = _.get(manifest, manifestKey)
    if (_.isArray(referencedFlows)) {
      for (const referencedFlow of referencedFlows) {
        debug(`Following ${manifestKey} reference '${referencedFlow.name || referencedFlow.id}' (${referencedFlow.id}) from flow '${flowName || flowId}'`)
        await collectBotFlowsRecursive({
          apiEndPoint,
          accessToken,
          flowId: referencedFlow.id,
          flowName: referencedFlow.name,
          depth: depth + 1,
          visitedFlowIds,
          botFlowsById
        })
      }
    }
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
  const requestedLanguage = normalizeLanguage(language)
  const defaultNluDomainVersion = await fetchNluDomainVersion(apiEndPoint, accessToken, domainId, domainVersionId, true)
  const defaultLanguage = normalizeLanguage(defaultNluDomainVersion.language)
  const availableLanguages = supportedLanguages(defaultNluDomainVersion)
  const resolvedVersionId = resolveNluDomainVersionId({ domainVersion: defaultNluDomainVersion, domainVersionId, language: requestedLanguage })

  let imported = false
  if (!resolvedVersionId) {
    debug(`Skipping NLU domain '${domainId}' for bot flow '${botFlowId}' because language '${requestedLanguage}' is not available, supported languages are '${availableLanguages.join(', ')}'`)
  } else {
    const responseNluDomain = resolvedVersionId === domainVersionId
      ? defaultNluDomainVersion
      : await fetchNluDomainVersion(apiEndPoint, accessToken, domainId, resolvedVersionId, true)

    let importedUtteranceCount = 0
    for (const intent of _.get(responseNluDomain, 'intents') || []) {
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
            importedUtteranceCount++
          }
        }
      }
    }
    chatbotData.push(responseNluDomain)
    imported = true
    debug(`Imported ${importedUtteranceCount} utterances from NLU domain '${domainId}' version '${resolvedVersionId}' language '${normalizeLanguage(responseNluDomain.language) || defaultLanguage}' for bot flow '${botFlowId}'`)
  }

  const knowledgeBaseId = _.get(responseBotFlowConfig, 'knowledgeSettings.knowledgeBaseId')
  if (knowledgeBaseId && requestedLanguage && defaultLanguage && requestedLanguage !== defaultLanguage) {
    debug(`Skipping knowledge base '${knowledgeBaseId}' for bot flow '${botFlowId}' because the Genesys knowledge API cannot be queried by language and the knowledge base holds the '${defaultLanguage}' content of the bot flow`)
  } else if (knowledgeBaseId) {
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
      let importedAlternativeCount = 0
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
              importedAlternativeCount++
            }
          }
        }
      }
      chatbotData.push(responseKnowledgeBase)
      debug(`Imported ${importedAlternativeCount} knowledge alternatives from knowledge base '${knowledgeBaseId}' for bot flow '${botFlowId}'`)

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
  } else {
    debug(`No knowledge base configured for bot flow '${botFlowId}', skipping knowledge import`)
  }

  return { imported, availableLanguages }
}

const _importIt = async ({ caps, inboundFlowType, inboundFlowName, botFlowId, clientId, clientSecret, language }) => {
  const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], clientId || caps[Capabilities.GENESYS_CLIENT_ID], clientSecret || caps[Capabilities.GENESYS_CLIENT_SECRET])
  const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)
  const requestedLanguage = normalizeLanguage(language || _.get(caps, Capabilities.GENESYS_LANGUAGE))

  const utterances = {}
  const chatbotData = []
  const importResults = []
  if (botFlowId) {
    importResults.push(await _updateUtterancesByBotFlow(apiEndPoint, accessToken, botFlowId, chatbotData, utterances, requestedLanguage))
  } else {
    const botFlows = await getBotFlows(inboundFlowName, apiEndPoint, accessToken, inboundFlowType)
    if (botFlows.length === 0) {
      debug(`No bot flows found in inbound flow '${inboundFlowName}' and type '${inboundFlowType}', returning empty import result`)
      return { chatbotData: {}, rawUtterances: {} }
    }
    debug(`Importing intents from bot flows: ${botFlowNames(botFlows)}`)
    for (const botFlow of botFlows) {
      importResults.push(await _updateUtterancesByBotFlow(apiEndPoint, accessToken, botFlow.id, chatbotData, utterances, requestedLanguage))
    }
  }

  if (requestedLanguage && !importResults.some(importResult => importResult.imported)) {
    const availableLanguages = _.uniq(_.flatten(importResults.map(importResult => importResult.availableLanguages)))
    throw new Error(availableLanguages.length > 0
      ? `No NLU domain found for language '${requestedLanguage}', available languages are '${availableLanguages.join(', ')}'`
      : `No NLU domain found for language '${requestedLanguage}'`)
  }

  return { chatbotData: chatbotData.length > 1 ? chatbotData : chatbotData[0], rawUtterances: utterances }
}

/**
 *
 * @param inboundFlowName
 * @param apiEndPoint
 * @param accessToken
 * @param inboundFlowType
 * @returns {Promise<[]>}
 */
const getBotFlows = async (inboundFlowName, apiEndPoint, accessToken, inboundFlowType = 'INBOUNDSHORTMESSAGE') => {
  if (!inboundFlowName) {
    throw new Error('Inbound flow name is required')
  }
  const reqOptionInboundMessageFlow = {
    method: 'get',
    url: `${apiEndPoint}/api/v2/flows?name=${encodeURIComponent(inboundFlowName)}&type=${encodeURIComponent(inboundFlowType)}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }
  debug(`Request by name for inbound message flow: ${JSON.stringify(reqOptionInboundMessageFlow, null, 2)}`)
  const responseInboundMessageFlow = await fetchWithCustomError(reqOptionInboundMessageFlow, 'Request by name for inbound message flow')
  const inboundMessageFlows = responseInboundMessageFlow.entities
  if (inboundMessageFlows.length === 0) {
    throw new Error(`Inbound flow not found by name '${inboundFlowName}' and type '${inboundFlowType}'`)
  }
  if (inboundMessageFlows.length > 1) {
    throw new Error(`Multiple inbound flows found by name '${inboundFlowName}' and type '${inboundFlowType}'`)
  }

  const inboundMessageFlow = inboundMessageFlows[0]
  const botFlowsById = new Map()
  await collectBotFlowsRecursive({
    apiEndPoint,
    accessToken,
    flowId: inboundMessageFlow.id,
    flowName: inboundFlowName,
    depth: 0,
    visitedFlowIds: new Set(),
    botFlowsById
  })

  const botFlows = Array.from(botFlowsById.values())
  debug(`Found ${botFlows.length} bot flows in inbound flow '${inboundFlowName}' and type '${inboundFlowType}': ${botFlowNames(botFlows)}`)
  return botFlows
}

/**
 *
 * @param caps
 * @param buildconvos
 * @param inboundFlowName
 * @param botFlowId
 * @param clientId
 * @param clientSecret
 * @param language - in "en-us" format, or null for the default language of the NLU domain
 * @returns {Promise<{utterances: *, convos: *}>}
 */
const importGenesysBotFlowIntents = async ({ caps, buildconvos, inboundFlowType, inboundFlowName, botFlowId, clientId, clientSecret, language }) => {
  try {
    const downloadResult = await _importIt({ caps, inboundFlowType, inboundFlowName, botFlowId, clientId, clientSecret, language })
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

/**
 *
 * @param inboundFlowName
 * @param apiEndPoint
 * @param accessToken
 * @param inboundFlowType
 * @param language - in "en-us" format, or null to use the default language of each bot flow
 * @returns {Promise<[]>}
 */
const getBotFlowsConfiguration = async ({ inboundFlowName, apiEndPoint, accessToken, inboundFlowType = 'INBOUNDSHORTMESSAGE', language } = {}) => {
  const botFlows = await getBotFlows(inboundFlowName, apiEndPoint, accessToken, inboundFlowType)
  if (botFlows.length === 0) {
    throw new Error(`No bot flows found in inbound flow '${inboundFlowName}' and type '${inboundFlowType}'`)
  }
  const requestedLanguage = normalizeLanguage(language)
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

    const botFlowConfiguration = {
      id: botFlow.id,
      name: responseBotFlowConfig.name,
      domainId: _.get(responseBotFlowConfig, 'botFlowSettings.nluDomainId'),
      domainVersionId: _.get(responseBotFlowConfig, 'botFlowSettings.nluDomainVersionId'),
      knowledgeBaseId: _.get(responseBotFlowConfig, 'knowledgeSettings.knowledgeBaseId'),
      maxNumOfAnswersReturned: _.get(responseBotFlowConfig, 'knowledgeSettings.maxNumOfAnswersReturned.text') || '3',
      responseBias: _.get(responseBotFlowConfig, 'knowledgeSettings.responseBias.text') || 'neutral'
    }

    // only needed to tell apart the languages a bot flow can be asked for, so skipped by default
    if (requestedLanguage && botFlowConfiguration.domainId && botFlowConfiguration.domainVersionId) {
      const defaultNluDomainVersion = await fetchNluDomainVersion(apiEndPoint, accessToken, botFlowConfiguration.domainId, botFlowConfiguration.domainVersionId, false)
      botFlowConfiguration.language = normalizeLanguage(defaultNluDomainVersion.language)
      botFlowConfiguration.supportedLanguages = supportedLanguages(defaultNluDomainVersion)
      debug(`Bot flow '${botFlowConfiguration.name}' supports languages '${botFlowConfiguration.supportedLanguages.join(', ')}'`)
    }

    botFlowsConfiguration.push(botFlowConfiguration)
  }

  if (requestedLanguage && !botFlowsConfiguration.some(botFlowConf => supportsLanguage(botFlowConf, requestedLanguage))) {
    const languagesByBotFlow = botFlowsConfiguration
      .map(botFlowConf => `'${botFlowConf.name}' supports '${(botFlowConf.supportedLanguages || []).join(', ')}'`)
      .join(', ')
    throw new Error(`No bot flow found for language '${requestedLanguage}' in inbound flow '${inboundFlowName}': ${languagesByBotFlow}`)
  }

  return botFlowsConfiguration
}

const detectIntentInDomain = async (botFlowConf, apiEndPoint, accessToken, messageText, mostConfidentIntentSoFar, language) => {
  const input = { text: messageText }
  const requestedLanguage = normalizeLanguage(language)
  if (requestedLanguage) {
    input.language = requestedLanguage
  }
  const reqOptionDetectIntentConfig = {
    method: 'post',
    url: `${apiEndPoint}/api/v2/languageunderstanding/domains/${botFlowConf.domainId}/versions/${botFlowConf.domainVersionId}/detect`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input })
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

const detectNlpData = async (params) => {
  const { botFlowsConfiguration, apiEndPoint, accessToken, messageText, messageId, botFlowNameField, language } = params
  debug(`Detecting NLP data with params: ${JSON.stringify(params, null, 2)}`)
  if (!_.isArray(botFlowsConfiguration) || botFlowsConfiguration.length === 0) {
    throw new Error('No bot flow configuration available for NLP detection')
  }
  const requestedLanguage = normalizeLanguage(language)

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
    if (botFlowName) {
      debug(`Resolved bot flow '${botFlowName}' from conversation attribute '${botFlowNameField}'`)
    } else {
      debug(`Conversation attribute '${botFlowNameField}' was not found, detecting NLP data using configured bot flows`)
    }
  }

  let intents = []
  const detectNlpDataByFlow = async (botFlowConf) => {
    // the Genesys knowledge API cannot be queried by language, so it only serves the default language of the bot flow
    const knowledgeLanguageMismatch = requestedLanguage && botFlowConf.language && requestedLanguage !== botFlowConf.language
    const knowledgeBaseId = knowledgeLanguageMismatch ? null : botFlowConf.knowledgeBaseId
    if (knowledgeLanguageMismatch && botFlowConf.knowledgeBaseId) {
      debug(`Skipping knowledge search for bot flow '${botFlowConf.name}' because its knowledge base holds '${botFlowConf.language}' content and language '${requestedLanguage}' was requested`)
    }

    if (knowledgeBaseId && messageText && messageText.length >= 3) {
      const responseBias = botFlowConf.responseBias
      debug(`Detecting NLP data in bot flow '${botFlowConf.name}' with response bias '${responseBias}' and knowledge base '${knowledgeBaseId}'`)
      if (responseBias === 'intents') {
        const detectedIntents = await detectIntentInDomain(botFlowConf, apiEndPoint, accessToken, messageText, intents[0], requestedLanguage)
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
        const detectedIntents = await detectIntentInDomain(botFlowConf, apiEndPoint, accessToken, messageText, intents[0], requestedLanguage)
        if (detectedIntents.length > 0) {
          intents = detectedIntents
        }
      }
    } else {
      if (knowledgeBaseId && (!messageText || messageText.length < 3)) {
        debug(`Skipping knowledge search for bot flow '${botFlowConf.name}' because message text is shorter than 3 characters`)
      } else if (!botFlowConf.knowledgeBaseId) {
        debug(`No knowledge base configured for bot flow '${botFlowConf.name}', using intent detection only`)
      }
      const detectedIntents = await detectIntentInDomain(botFlowConf, apiEndPoint, accessToken, messageText, intents[0], requestedLanguage)
      if (detectedIntents.length > 0) {
        intents = detectedIntents
      }
    }
  }

  const matchingBotFlowConfiguration = botFlowName && _.find(botFlowsConfiguration, bfConfig => bfConfig.name === botFlowName)
  if (matchingBotFlowConfiguration) {
    if (supportsLanguage(matchingBotFlowConfiguration, requestedLanguage)) {
      debug(`Detecting NLP data using bot flow '${botFlowName}'`)
      await detectNlpDataByFlow(matchingBotFlowConfiguration)
    } else {
      debug(`Skipping bot flow '${botFlowName}' because it does not support language '${requestedLanguage}', supported languages are '${(matchingBotFlowConfiguration.supportedLanguages || []).join(', ')}'`)
    }
  } else {
    if (botFlowName) {
      debug(`Bot flow '${botFlowName}' from conversation attribute '${botFlowNameField}' was not found in configured bot flows: ${botFlowsConfiguration.map(bfConfig => bfConfig.name).join(', ')}`)
    } else {
      debug(`Detecting NLP data using all configured bot flows: ${botFlowsConfiguration.map(bfConfig => bfConfig.name).join(', ')}`)
    }
    for (const botFlowConf of botFlowsConfiguration) {
      // an NLU domain without the requested language would answer in another language and could outrank the correct match
      if (!supportsLanguage(botFlowConf, requestedLanguage)) {
        debug(`Skipping bot flow '${botFlowConf.name}' because it does not support language '${requestedLanguage}', supported languages are '${(botFlowConf.supportedLanguages || []).join(', ')}'`)
        continue
      }
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
  } else {
    debug('No intents detected, returning empty NLP data')
  }
  return nlp
}

const resolveImportFlowParams = ({ caps, inboundFlowType, inboundFlowName }) => {
  const flowType = inboundFlowType ?? _.get(caps, Capabilities.GENESYS_INBOUND_FLOW_TYPE) ?? 'INBOUNDSHORTMESSAGE'
  const fromCapsMessage = _.get(caps, Capabilities.GENESYS_INBOUND_MESSAGE_FLOW_NAME)
  const fromCapsCall = _.get(caps, Capabilities.GENESYS_INBOUND_CALL_FLOW_NAME)
  let flowName = inboundFlowName
  if (!flowName) {
    flowName = flowType === 'INBOUNDCALL'
      ? (fromCapsCall || fromCapsMessage)
      : (fromCapsMessage || fromCapsCall)
  }
  debug(`Resolved import flow params: inboundFlowType '${flowType}', inboundFlowName '${flowName || 'not provided'}'`)
  return { inboundFlowType: flowType, inboundFlowName: flowName }
}

module.exports = {
  importHandler: ({ caps, buildconvos, inboundFlowType, inboundFlowName, botFlowId, clientId, clientSecret, language, ...rest } = {}) => {
    const resolved = resolveImportFlowParams({ caps, inboundFlowType, inboundFlowName })
    return importGenesysBotFlowIntents({
      caps,
      buildconvos,
      inboundFlowType: resolved.inboundFlowType,
      inboundFlowName: resolved.inboundFlowName,
      botFlowId,
      clientId,
      clientSecret,
      language,
      ...rest
    })
  },
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
    inboundFlowType: {
      describe: 'Inbound flow type',
      type: 'choice',
      required: false,
      choices: [
        { key: 'INBOUNDSHORTMESSAGE', name: 'Inbound Message' },
        { key: 'INBOUNDCALL', name: 'Inbound Call' }
      ]
    },
    inboundFlowName: {
      describe: 'Inbound flow name from genesys architect view',
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
      describe: 'Language (like en-us), defaults to the GENESYS_LANGUAGE capability or the default language of the bot flow',
      type: 'string'
    }
  },
  getBotFlowsConfiguration,
  detectNlpData,
  getBotFlows,
  normalizeLanguage,
  supportedLanguages,
  resolveNluDomainVersionId
}

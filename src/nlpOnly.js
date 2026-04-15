const _ = require('lodash')
const { v4: uuidv4 } = require('uuid')
const { Capabilities, UrlsByRegion } = require('./constants')
const { getAccessToken } = require('./util')
const { getBotFlowsConfiguration, detectNlpData } = require('./intents')

const inboundFlowNameForCaps = (caps) => {
  const flowType = caps[Capabilities.GENESYS_INBOUND_FLOW_TYPE]
  if (flowType === 'INBOUNDCALL') {
    return caps[Capabilities.GENESYS_INBOUND_CALL_FLOW_NAME]
  }
  return caps[Capabilities.GENESYS_INBOUND_MESSAGE_FLOW_NAME]
}

const Validate = async (connector) => {
  if (!connector.caps[Capabilities.GENESYS_AWS_REGION]) throw new Error('GENESYS_AWS_REGION capability required')
  if (!connector.caps[Capabilities.GENESYS_CLIENT_ID]) throw new Error('GENESYS_CLIENT_ID capability required')
  if (!connector.caps[Capabilities.GENESYS_CLIENT_SECRET]) throw new Error('GENESYS_CLIENT_SECRET capability required')
  if (!connector.caps[Capabilities.GENESYS_INBOUND_MESSAGE_FLOW_NAME] && !connector.caps[Capabilities.GENESYS_INBOUND_CALL_FLOW_NAME]) throw new Error('Either GENESYS_INBOUND_MESSAGE_FLOW_NAME or GENESYS_INBOUND_CALL_FLOW_NAME capabilities required')
  if (!connector.caps[Capabilities.GENESYS_INBOUND_FLOW_TYPE]) throw new Error('GENESYS_INBOUND_FLOW_TYPE capability required')
  connector.apiEndpoint = _.get(UrlsByRegion, `${connector.caps[Capabilities.GENESYS_AWS_REGION]}.api`)
  if (!connector.apiEndpoint) {
    throw new Error(`No api endpoint found for '${connector.caps[Capabilities.GENESYS_AWS_REGION]}' aws region.`)
  }
}

const Build = async (connector) => {}

const Start = async (connector) => {
  connector.view = {
    container: connector,
    context: {},
    msg: {},
    botium: {
      conversationId: uuidv4(),
      stepId: null
    }
  }

  connector.view.botium.accessToken = await getAccessToken(connector.caps[Capabilities.GENESYS_AWS_REGION], connector.caps[Capabilities.GENESYS_CLIENT_ID], connector.caps[Capabilities.GENESYS_CLIENT_SECRET])
  connector.botFlowsConfiguration = await getBotFlowsConfiguration(
    inboundFlowNameForCaps(connector.caps),
    connector.apiEndpoint,
    connector.view.botium.accessToken,
    connector.caps[Capabilities.GENESYS_INBOUND_FLOW_TYPE]
  )
}

const UserSays = async (connector, msg) => {
    let botMsg = {
        sender: 'bot',
        sourceData: {
          request: {
            messageText: msg.messageText,
            buttons: msg.buttons,
            media: msg.media
          }
        }
      }

    botMsg.nlp = await detectNlpData({
      botFlowsConfiguration: connector.botFlowsConfiguration,
      apiEndPoint: connector.apiEndpoint,
      accessToken: connector.view.botium.accessToken,
      messageText: msg.messageText,
      botFlowNameField: connector.caps[Capabilities.GENESYS_BOT_FLOW_ATTRIBUTE_NAME]
    })
  connector.queueBotSays(botMsg)
}

const Stop = async (connector) => {
  connector.view = null
}

const Clean = async (connector) => {
  if (connector.view && connector.view.botium) {
    connector.view.botium.accessToken = null
  }
  connector.view = null
  connector.botFlowsConfiguration = null
}

module.exports = {
  Validate,
  Build,
  Start,
  UserSays,
  Stop,
  Clean
}

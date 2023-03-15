const util = require('util')
const _ = require('lodash')
const randomize = require('randomatic')
const debug = require('debug')('botium-connector-genesys-open-messaging')
const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const { Capabilities: CoreCapabilities } = require('botium-core')
const { Capabilities, UrlsByRegion } = require('./constants')
const { getAccessToken } = require('./util')

const Validate = async (connector) => {
  if (!connector.caps[Capabilities.GENESYS_CLIENT_ID]) throw new Error('GENESYS_CLIENT_ID capability required')
  if (!connector.caps[Capabilities.GENESYS_CLIENT_SECRET]) throw new Error('GENESYS_CLIENT_SECRET capability required')
  if (!connector.caps[Capabilities.GENESYS_OPEN_MESSAGING_INTEGRATION_ID]) throw new Error('GENESYS_OPEN_MESSAGING_INTEGRATION_ID capability required')
  connector.apiEndpoint = _.get(UrlsByRegion, `${connector.caps[Capabilities.GENESYS_AWS_REGION]}.api`)
  if (!connector.apiEndpoint) {
    throw new Error(`No api endpoint found for '${connector.caps[Capabilities.GENESYS_AWS_REGION]}' aws region.`)
  }
  connector.authEndpoint = _.get(UrlsByRegion, `${connector.caps[Capabilities.GENESYS_AWS_REGION]}.auth`)
  if (!connector.authEndpoint) {
    throw new Error(`No auth endpoint found for '${connector.caps[Capabilities.GENESYS_AWS_REGION]}' aws region.`)
  }

  if (!connector.delegateContainer) {
    connector.delegateCaps = {
      [CoreCapabilities.SIMPLEREST_URL]: `${connector.apiEndpoint}/api/v2/conversations/messages/inbound/open`,
      [CoreCapabilities.SIMPLEREST_METHOD]: 'POST',
      [CoreCapabilities.SIMPLEREST_START_HOOK]: async ({ context, botium }) => {
        botium.accessToken = await getAccessToken(
          connector.caps[Capabilities.GENESYS_AWS_REGION],
          connector.caps[Capabilities.GENESYS_CLIENT_ID],
          connector.caps[Capabilities.GENESYS_CLIENT_SECRET]
        )
        connector.from = connector.caps[Capabilities.GENESYS_USER_DATA] || { id: botium.conversationId }
        botium.userId = connector.from.id
      },
      [CoreCapabilities.SIMPLEREST_REQUEST_HOOK]: async ({ requestOptions, msg, context, botium }) => {
        const headers = {
          'content-type': 'application/json',
          authorization: `Bearer ${botium.accessToken}`
        }
        requestOptions.headers = Object.assign(requestOptions.headers || {}, headers)

        requestOptions.json = true
        const body = {
          id: botium.conversationId,
          channel: {
            platform: 'Open',
            type: 'Private',
            messageId: randomize('0', 10),
            to: {
              id: connector.caps[Capabilities.GENESYS_OPEN_MESSAGING_INTEGRATION_ID]
            },
            from: connector.from,
            time: new Date()
          },
          direction: 'Inbound'
        }

        // Only text based communication is supported by open messaging channel
        body.type = 'Text'
        body.text = msg.messageText
        requestOptions.body = body
      },
      [CoreCapabilities.SIMPLEREST_RESPONSE_HOOK]: ({ botMsg }) => {
        debug(`Response Body: ${util.inspect(botMsg.sourceData, false, null, true)}`)

        if (botMsg.sourceData.direction === 'Outbound') {
          botMsg.buttons = botMsg.buttons || []
          botMsg.media = botMsg.media || []
          botMsg.cards = botMsg.cards || []

          if (botMsg.sourceData.type === 'Text') {
            botMsg.messageText = botMsg.sourceData.text
          }
        }
      },
      [CoreCapabilities.SIMPLEREST_INBOUND_SELECTOR_JSONPATH]: ['$.body.channel.to.id'],
      [CoreCapabilities.SIMPLEREST_INBOUND_SELECTOR_VALUE]: '{{botium.userId}}'
    }
    for (const capKey of Object.keys(connector.caps).filter(c => c.startsWith('SIMPLEREST'))) {
      if (!connector.delegateCaps[capKey]) connector.delegateCaps[capKey] = connector.caps[capKey]
    }

    debug(`Validate delegateCaps ${util.inspect(connector.delegateCaps)}`)
    connector.delegateContainer = new SimpleRestContainer({ queueBotSays: connector.queueBotSays, caps: connector.delegateCaps })
  }

  debug('Validate delegate')
  return connector.delegateContainer.Validate()
}

const Build = async (connector) => {
  await connector.delegateContainer.Build()
}

const Start = async (connector) => {
  await connector.delegateContainer.Start()
}

const UserSays = async (connector, msg) => {
  await connector.delegateContainer.UserSays(msg)
}

const Stop = async (connector) => {
  await connector.delegateContainer.Stop()
}

const Clean = async (connector) => {
  await connector.delegateContainer.Clean()
}

module.exports = {
  Validate,
  Build,
  Start,
  UserSays,
  Stop,
  Clean
}

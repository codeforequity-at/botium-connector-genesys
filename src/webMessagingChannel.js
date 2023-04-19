const path = require('path')
const util = require('util')
const { v4: uuidv4 } = require('uuid')
const axios = require('axios')
const WebSocket = require('ws')
const _ = require('lodash')
const Queue = require('bull')
const debug = require('debug')('botium-connector-genesys-web-messaging')
const { Capabilities, UrlsByRegion } = require('./constants')
const { detectNlpData, getBotFlowsConfiguration } = require('./intents')
const { getAccessToken } = require('./util')

const Validate = async (connector) => {
  if (!connector.caps[Capabilities.GENESYS_DEPLOYMENT_ID]) throw new Error('GENESYS_DEPLOYMENT_ID capability required')
  if (!connector.caps[Capabilities.GENESYS_AWS_REGION]) throw new Error('GENESYS_AWS_REGION capability required')

  connector.wsEndpoint = _.get(UrlsByRegion, `${connector.caps[Capabilities.GENESYS_AWS_REGION]}.websocket`)
  if (!connector.wsEndpoint) {
    throw new Error(`No websocket address found for '${connector.caps[Capabilities.GENESYS_AWS_REGION]}' aws region.`)
  }
  if (!!connector.caps[Capabilities.GENESYS_NLP_ANALYTICS] === true) {
    if (!connector.caps[Capabilities.GENESYS_CLIENT_ID]) throw new Error('GENESYS_CLIENT_ID capability required for NLP analytics')
    if (!connector.caps[Capabilities.GENESYS_CLIENT_SECRET]) throw new Error('GENESYS_CLIENT_SECRET capability required for NLP analytics')
    if (!connector.caps[Capabilities.GENESYS_INBOUND_MESSAGE_FLOW_NAME]) throw new Error('GENESYS_INBOUND_MESSAGE_FLOW_NAME capability required for NLP analytics')
    connector.apiEndpoint = _.get(UrlsByRegion, `${connector.caps[Capabilities.GENESYS_AWS_REGION]}.api`)
    if (!connector.apiEndpoint) {
      throw new Error(`No api endpoint found for '${connector.caps[Capabilities.GENESYS_AWS_REGION]}' aws region.`)
    }
    connector.authEndpoint = _.get(UrlsByRegion, `${connector.caps[Capabilities.GENESYS_AWS_REGION]}.auth`)
    if (!connector.authEndpoint) {
      throw new Error(`No auth endpoint found for '${connector.caps[Capabilities.GENESYS_AWS_REGION]}' aws region.`)
    }
  }
}

const Build = async (connector) => {

}

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

  if (!!connector.caps[Capabilities.GENESYS_NLP_ANALYTICS] === true) {
    connector.view.botium.accessToken = await getAccessToken(connector.caps[Capabilities.GENESYS_AWS_REGION], connector.caps[Capabilities.GENESYS_CLIENT_ID], connector.caps[Capabilities.GENESYS_CLIENT_SECRET])
    connector.botFlowsConfiguration = await getBotFlowsConfiguration(connector.caps[Capabilities.GENESYS_INBOUND_MESSAGE_FLOW_NAME], connector.apiEndpoint, connector.view.botium.accessToken)
    connector.view.botium.botMsgQueue = new Queue('botMsgQueue')

    connector.view.botium.botMsgQueue.process(async (job, done) => {
      if (connector.currentMessageText) {
        job.data.nlp = await detectNlpData(connector.botFlowsConfiguration, connector.apiEndpoint, connector.view.botium.accessToken, connector.currentMessageText)
        connector.currentMessageText = undefined
      }
      connector.queueBotSays(job.data)
      done()
    })
  }

  return new Promise((resolve, reject) => {
    const webSockerUrl = `${connector.wsEndpoint}?deploymentId=${connector.caps[Capabilities.GENESYS_DEPLOYMENT_ID]}`
    connector.ws = new WebSocket(webSockerUrl)

    connector.wsOpened = false
    connector.ws.on('open', () => {
      debug(`Websocket connection to ${webSockerUrl} opened.`)

      connector.ws.send(JSON.stringify({
        action: 'configureSession',
        deploymentId: connector.caps[Capabilities.GENESYS_DEPLOYMENT_ID],
        token: connector.view.botium.conversationId
      }))
    })

    connector.ws.on('close', async () => {
      debug(`Websocket connection to ${webSockerUrl} closed.`)
    })

    connector.ws.on('error', (err) => {
      debug(err)
      if (!connector.wsOpened) {
        reject(new Error(`Websocket connection to ${webSockerUrl} error: ${err.message || err}`))
      }
    })

    connector.ws.on('message', async (data) => {
      const messageData = JSON.parse(data)
      debug(`Response Body: ${util.inspect(messageData, false, null, true)}`)
      if (messageData.class === 'SessionResponse' && messageData.code === 200 && _.get(messageData, 'body.connected') === true) {
        debug('Websocket session is configured')
        resolve()
      }

      if (messageData.type === 'response' && messageData.code >= 400) {
        const errorMsg = _.isString(messageData.body) ? messageData.body : 'Websocket session is failed to configure'
        debug(errorMsg)
        reject(new Error(errorMsg))
      }

      if (messageData.class === 'StructuredMessage' && _.get(messageData, 'body.direction') === 'Outbound') {
        const mapButtonPayload = (p) => {
          let payload
          try {
            payload = JSON.parse(p)
          } catch (err) {
            payload = p
          }
          return payload
        }
        const mapButton = (b) => ({
          text: b.text,
          payload: mapButtonPayload(b.payload) || null
        })
        const mapMedia = (m) => ({
          mediaUri: m.url,
          mimeType: m.mime || 'application/unknown'
        })

        const botMsg = {
          sourceData: messageData,
          buttons: [],
          media: [],
          cards: []
        }

        if (messageData.body.text) {
          botMsg.messageText = messageData.body.text
        }

        const richContents = _.get(messageData, 'body.content')
        if (richContents) {
          for (const richContent of richContents) {
            if (richContent.contentType === 'QuickReply') {
              botMsg.buttons.push(mapButton(richContent.quickReply))
            } else if (richContent.contentType === 'Attachment') {
              botMsg.media.push(mapMedia(richContent.attachment))
            } else {
              debug('Not Supported rich content type!')
            }
          }
        }

        if (!!connector.caps[Capabilities.GENESYS_NLP_ANALYTICS] === true) {
          await connector.view.botium.botMsgQueue.add(botMsg)
        } else {
          connector.queueBotSays(botMsg)
        }
      }
    })
  })
}

const UserSays = async (connector, msg) => {
  const messageData = {
    action: 'onMessage',
    token: connector.view.botium.conversationId
  }

  if (msg.buttons && msg.buttons.length > 0 && (msg.buttons[0].text || msg.buttons[0].payload)) {
    messageData.message = {
      type: 'Text',
      content: [
        {
          contentType: 'ButtonResponse',
          buttonResponse: {
            text: msg.buttons[0].text,
            payload: msg.buttons[0].payload,
            type: 'QuickReply'
          }
        }
      ]
    }
  } else if (msg.media && msg.media.length > 0) {
    const content = []
    for (const media of msg.media) {
      const attachmentRes = await _getAttachmentId(connector, media)
      content.push({
        contentType: 'Attachment',
        attachment: {
          id: attachmentRes.attachmentId
        }
      })
    }
    messageData.message = {
      type: 'Text',
      text: msg.messageText,
      content
    }
  } else {
    messageData.message = {
      type: 'Text',
      text: msg.messageText
    }
  }
  connector.currentMessageText = messageData.message.text
  connector.ws.send(JSON.stringify(messageData))
}

const Stop = async (connector) => {
  connector.ws.close()
}

const Clean = async (connector) => {
}

const _getAttachmentId = async (connector, media) => {
  return new Promise((resolve, reject) => {
    // getAttachmentId function steps in order:
    // 1. onAttachment
    // 2. listen on message where class is GenerateUrlError (reject) or PresignedUrlResponse
    // 3. Upload filedata with axios request
    // 4. Listen on message where class is UploadFailureEvent (reject) or UploadSuccessEvent (resolve)
    const onAttachmentData = {
      action: 'onAttachment',
      fileName: path.basename(media.mediaUri),
      fileType: media.mimeType,
      fileSize: media.buffer.length,
      token: connector.view.botium.conversationId
    }
    connector.ws.send(JSON.stringify(onAttachmentData))

    connector.ws.on('message', async (data) => {
      const messageData = JSON.parse(data)
      if (messageData.type === 'message' && messageData.class === 'UploadFailureEvent' && messageData.code >= 400) {
        reject(messageData.body)
      }

      if (messageData.type === 'message' && messageData.class === 'UploadSuccessEvent' && messageData.code === 200) {
        resolve(messageData.body)
      }

      if (messageData.type === 'response' && messageData.class === 'GenerateUrlError' && messageData.code >= 400) {
        reject(messageData.body)
      }

      if (messageData.type === 'response' && messageData.class === 'PresignedUrlResponse' && messageData.code === 200) {
        try {
          const requestOptions = {
            method: 'put',
            url: messageData.body.url,
            headers: Object.assign({}, messageData.body.headers, { 'Content-Type': 'text/plain' }),
            data: media.buffer
          }
          await axios(requestOptions)
        } catch (e) {
          reject(e)
        }
      }
    })
  })
}

module.exports = {
  Validate,
  Build,
  Start,
  UserSays,
  Stop,
  Clean
}

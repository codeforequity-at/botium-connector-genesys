const debug = require('debug')('botium-connector-genesys')
const { Capabilities } = require('./constants')
const openMessaging = require('./openMessagingChannel')
const webMessaging = require('./webMessagingChannel')
const MessagingChannelTypes = {
  OPEN_MESSAGING: 'OPEN_MESSAGING',
  WEB_MESSAGING: 'WEB_MESSAGING'
}

class BotiumConnectorGenesys {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
    this.delegateContainer = null
    this.delegateCaps = null
  }

  async Validate () {
    debug('Validate called')

    this.caps = Object.assign({}, this.caps)

    if (!this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL]) throw new Error('GENESYS_MESSAGING_CHANNEL capability required')

    if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.OPEN_MESSAGING) {
      return openMessaging.Validate(this)
    } else if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.WEB_MESSAGING) {
      return webMessaging.Validate(this)
    } else {
      throw new Error(`Not supported messaging channel: '${this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL]}'`)
    }
  }

  async Build () {
    if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.OPEN_MESSAGING) {
      await openMessaging.Build(this)
    } else if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.WEB_MESSAGING) {
      await webMessaging.Build(this)
    } else {
      throw new Error(`Not supported messaging channel: '${this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL]}'`)
    }
  }

  async Start () {
    if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.OPEN_MESSAGING) {
      await openMessaging.Start(this)
    } else if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.WEB_MESSAGING) {
      await webMessaging.Start(this)
    } else {
      throw new Error(`Not supported messaging channel: '${this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL]}'`)
    }
  }

  async UserSays (msg) {
    if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.OPEN_MESSAGING) {
      await openMessaging.UserSays(this, msg)
    } else if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.WEB_MESSAGING) {
      await webMessaging.UserSays(this, msg)
    } else {
      throw new Error(`Not supported messaging channel: '${this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL]}'`)
    }
  }

  async Stop () {
    if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.OPEN_MESSAGING) {
      await openMessaging.Stop(this)
    } else if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.WEB_MESSAGING) {
      await webMessaging.Stop(this)
    } else {
      throw new Error(`Not supported messaging channel: '${this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL]}'`)
    }
  }

  async Clean () {
    if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.OPEN_MESSAGING) {
      await openMessaging.Clean(this)
    } else if (this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL] === MessagingChannelTypes.WEB_MESSAGING) {
      await webMessaging.Clean(this)
    } else {
      throw new Error(`Not supported messaging channel: '${this.caps[Capabilities.GENESYS_MESSAGING_CHANNEL]}'`)
    }
  }
}

module.exports = BotiumConnectorGenesys

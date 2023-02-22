const BotiumConnectorGenesys = require('./src/connector')
const fs = require('fs')
const path = require('path')

const logo = fs.readFileSync(path.join(__dirname, 'logo.png')).toString('base64')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorGenesys,
  PluginDesc: {
    name: 'Genesys',
    avatar: logo,
    provider: 'Genesys',
    features: {
      sendAttachments: true
    }
  }
}

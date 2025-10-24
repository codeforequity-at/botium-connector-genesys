const BotiumConnectorGenesys = require('./src/connector')
const { importHandler, importArgs, getBotFlows } = require('./src/intents')
const fs = require('fs')
const path = require('path')
const { getAccessToken } = require('./src/util')
const { Capabilities, UrlsByRegion } = require('./src/constants')
const _ = require('lodash')

const logo = fs.readFileSync(path.join(__dirname, 'logo.png')).toString('base64')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorGenesys,
  Import: {
    Handler: importHandler,
    Args: importArgs
  },
  PluginDesc: {
    name: 'Genesys',
    avatar: logo,
    provider: 'Genesys',
    features: {
      sendAttachments: true,
      testCaseGeneration: true,
      intentResolution: true,
      intentConfidenceScore: true,
      alternateIntents: true,
      entityResolution: true,
      entityConfidenceScore: true
    },
    capabilities: [
      {
        name: 'GENESYS_MESSAGING_CHANNEL',
        label: 'Genesys messaging channel',
        type: 'choice',
        required: true,
        choices: [
          { key: 'WEB_MESSAGING', name: 'Web messaging (websocket)' },
          { key: 'OPEN_MESSAGING', name: 'Open messaging (webhook)' }
        ]
      },
      {
        name: 'GENESYS_AWS_REGION',
        label: 'AWS Region',
        type: 'choice',
        required: true,
        choices: [
          { key: 'us-east-1', name: 'US East (Virginia) - us-east-1' },
          { key: 'us-east-2', name: 'US East 2 (Ohio) - us-east-2' },
          { key: 'us-west-2', name: 'US West (Oregon) - us-west-2' },
          { key: 'ca-central-1', name: 'Canada (Central) - ca-central-1' },
          { key: 'eu-west-1', name: 'Europe (Ireland) - eu-west-1' },
          { key: 'eu-west-2', name: 'Europe (London) - eu-west-2' },
          { key: 'eu-central-1', name: 'Europe (Frankfurt) - eu-central-1' },
          { key: 'ap-northeast-1', name: 'Asia Pacific (Tokyo) - ap-northeast-1' },
          { key: 'ap-south-1', name: 'Asia Pacific (Mumbai) - ap-south-1' },
          { key: 'ap-northeast-2', name: 'Asia Pacific (Seoul) - ap-northeast-2' },
          { key: 'ap-southeast-2', name: 'Asia Pacific (Sydney) - ap-southeast-2' },
          { key: 'sa-east-1', name: 'South America (Sao Paulo) - sa-east-1' }
        ]
      },
      {
        name: 'GENESYS_DEPLOYMENT_ID',
        label: 'Deployment ID',
        type: 'string',
        required: false
      },
      {
        name: 'GENESYS_CLIENT_ID',
        label: 'Client ID',
        type: 'string',
        required: false
      },
      {
        name: 'GENESYS_CLIENT_SECRET',
        label: 'Client Secret',
        type: 'secret',
        required: false
      },
      {
        name: 'GENESYS_OPEN_MESSAGING_INTEGRATION_ID',
        label: 'Open Messaging integration ID',
        type: 'string',
        required: false
      },
      {
        name: 'GENESYS_USER_DATA',
        label: 'User data',
        type: 'json',
        required: false
      },
      {
        name: 'GENESYS_NLP_ANALYTICS',
        label: 'Enable NLP Analytics',
        type: 'boolean',
        required: false
      },
      {
        name: 'GENESYS_RICH_CONTENT_SUPPORT',
        label: 'Enable Rich Content Support',
        type: 'boolean',
        required: false
      },
      {
        name: 'GENESYS_INBOUND_MESSAGE_FLOW_NAME',
        label: 'Inbound Message Flow Name',
        type: 'string',
        required: false
      },
      {
        name: 'GENESYS_BOT_FLOW',
        label: 'Bot Flow',
        type: 'query',
        required: false,
        query: async (caps) => {
          if (caps && caps[Capabilities.GENESYS_AWS_REGION] && caps.GENESYS_CLIENT_ID && caps.GENESYS_CLIENT_SECRET && caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME) {
            try {
              const accessToken = await getAccessToken(caps[Capabilities.GENESYS_AWS_REGION], caps[Capabilities.GENESYS_CLIENT_ID], caps[Capabilities.GENESYS_CLIENT_SECRET])
              const apiEndPoint = _.get(UrlsByRegion, `${caps[Capabilities.GENESYS_AWS_REGION]}.api`)

              const botFlows = await getBotFlows(caps.GENESYS_INBOUND_MESSAGE_FLOW_NAME, apiEndPoint, accessToken)
              return botFlows.map(b => ({ name: b.name, key: b.id }))
            } catch (err) {
              throw new Error(`Genesys BotFlows Query failed: ${err.message}`)
            }
          }
        }
      }
    ]
  }
}

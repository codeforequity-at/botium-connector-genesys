const Capabilities = {
  GENESYS_MESSAGING_CHANNEL: 'GENESYS_MESSAGING_CHANNEL',
  GENESYS_DEPLOYMENT_ID: 'GENESYS_DEPLOYMENT_ID',
  GENESYS_AWS_REGION: 'GENESYS_AWS_REGION',
  GENESYS_CLIENT_ID: 'GENESYS_CLIENT_ID',
  GENESYS_CLIENT_SECRET: 'GENESYS_CLIENT_SECRET',
  GENESYS_OPEN_MESSAGING_INTEGRATION_ID: 'GENESYS_OPEN_MESSAGING_INTEGRATION_ID',
  GENESYS_USER_DATA: 'GENESYS_USER_DATA',
  GENESYS_INBOUND_MESSAGE_FLOW_NAME: 'GENESYS_INBOUND_MESSAGE_FLOW_NAME',
  GENESYS_BOT_FLOW: 'GENESYS_BOT_FLOW',
  GENESYS_NLP_ANALYTICS: 'GENESYS_NLP_ANALYTICS',
  GENESYS_BOT_FLOW_ATTRIBUTE_NAME: 'GENESYS_BOT_FLOW_ATTRIBUTE_NAME'
}

const UrlsByRegion = {
  'us-east-1': {
    websocket: 'wss://webmessaging.mypurecloud.com/v1',
    auth: 'https://login.mypurecloud.com',
    api: 'https://api.mypurecloud.com'
  },
  'us-east-2': {
    auth: 'https://login.use2.us-gov-pure.cloud',
    api: 'https://api.use2.us-gov-pure.cloud'
  },
  'us-west-2': {
    websocket: 'wss://webmessaging.usw2.pure.cloud/v1',
    auth: 'https://login.usw2.pure.cloud',
    api: 'https://api.usw2.pure.cloud'
  },
  'ca-central-1': {
    websocket: 'wss://webmessaging.cac1.pure.cloud/v1',
    auth: 'https://login.cac1.pure.cloud',
    api: 'https://api.cac1.pure.cloud'
  },
  'eu-west-1': {
    websocket: 'wss://webmessaging.mypurecloud.ie/v1',
    auth: 'https://login.mypurecloud.ie',
    api: 'https://api.mypurecloud.ie'
  },
  'eu-west-2': {
    websocket: 'wss://webmessaging.euw2.pure.cloud/v1',
    auth: 'https://login.euw2.pure.cloud',
    api: 'https://api.euw2.pure.cloud'
  },
  'eu-central-1': {
    websocket: 'wss://webmessaging.mypurecloud.de/v1',
    auth: 'https://login.mypurecloud.de',
    api: 'https://api.mypurecloud.de'
  },
  'ap-south-1': {
    websocket: 'wss://webmessaging.aps1.pure.cloud/v1',
    auth: 'https://login.aps1.pure.cloud',
    api: 'https://api.aps1.pure.cloud'
  },
  'ap-northeast-1': {
    websocket: 'wss://webmessaging.mypurecloud.jp/v1',
    auth: 'https://login.mypurecloud.jp',
    api: 'https://api.mypurecloud.jp'
  },
  'ap-northeast-2': {
    websocket: 'wss://webmessaging.apne2.pure.cloud/v1',
    auth: 'https://login.apne2.pure.cloud',
    api: 'https://api.apne2.pure.cloud'
  },
  'ap-southeast-2': {
    websocket: 'wss://webmessaging.mypurecloud.com.au/v1',
    auth: 'https://login.mypurecloud.com.au',
    api: 'https://api.mypurecloud.com.au'
  },
  'sa-east-1': {
    websocket: 'wss://webmessaging.sae1.pure.cloud/v1',
    auth: 'https://login.sae1.pure.cloud',
    api: 'https://api.sae1.pure.cloud'
  }
}

module.exports = {
  Capabilities,
  UrlsByRegion
}

# Botium Connector for Genesys

[![NPM](https://nodei.co/npm/botium-connector-genesys.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/botium-connector-genesys/)

[![Codeship Status for codeforequity-at/botium-connector-genesys](https://app.codeship.com/projects/ac5ab3a0-d0f5-0138-cac3-16239a5027f5/status?branch=master)](https://app.codeship.com/projects/408148)
[![npm version](https://badge.fury.io/js/botium-connector-genesys.svg)](https://badge.fury.io/js/botium-connector-genesys)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)]()


This is a [Botium](https://github.com/codeforequity-at/botium-core) connector for testing your [Genesys chatbot](https://www.genesys.com/genesys-cloud).

__Did you read the [Botium in a Nutshell](https://medium.com/@floriantreml/botium-in-a-nutshell-part-1-overview-f8d0ceaf8fb4) articles? Be warned, without prior knowledge of Botium you won't be able to properly use this library!__

## How it works
Botium connects to the API of your Genesys chatbot.

It can be used as any other Botium connector with all Botium Stack components:
* [Botium CLI](https://github.com/codeforequity-at/botium-cli/)
* [Botium Bindings](https://github.com/codeforequity-at/botium-bindings/)
* [Botium Box](https://www.botium.at)

## Requirements
* **Node.js and NPM**
* a **Genesys bot flow**
* a **project directory** on your workstation to hold test cases and Botium configuration

## Install Botium and Genesys Connector

When using __Botium CLI__:

```
> npm install -g botium-cli
> npm install -g botium-connector-genesys
> botium-cli init
> botium-cli run
```

When using __Botium Bindings__:

```
> npm install -g botium-bindings
> npm install -g botium-connector-genesys
> botium-bindings init mocha
> npm install && npm run mocha
```

When using __Botium Box__:

_Already integrated into Botium Box, no setup required_

## Connecting Genesys chatbot to Botium

You can choose between Web messaging and Open messaging channels based on `GENESYS_MESSAGING_CHANNEL` (WEB_MESSAGING, OPEN_MESSAGING) capability.  

### Use web messaging channel (websocket) - Recommended

If you set 'WEB_MESSAGING' value in `GENESYS_MESSAGING_CHANNEL`, then you choose Web messaging channel, which is a websocket based channel.

In Genesys cloud you have to do the following:
* You have to have a `Digital Bot Flow` or a `Bot Flow`, which is connected to an `Inbound Message Flow` under Architect page
* You have to set up a `Messenger Configuration` under Admin page 
* You have to create a `Messenger Deployment` under Admin page

After the `Messenger Deployment` you create a `botium.json` file and copy the Deployment Key into `GENESYS_DEPLOYMENT_ID` 
and set your genesys account AWS region into `GENESYS_AWS_REGION`.

```
{
  "botium": {
    "Capabilities": {
      "PROJECTNAME": "<whatever>",
      "CONTAINERMODE": "genesys",
      "GENESYS_MESSAGING_CHANNEL": "WEB_MESSAGING",
      "GENESYS_AWS_REGION": "us-east-1",
      "GENESYS_DEPLOYMENT_ID": "baf4d3ab-d758-4439-995e-c4d86f6d9121"
    }
  }
}
```
To check the configuration, run the emulator (Botium CLI required) to bring up a chat interface in your terminal window:

```
> botium-cli emulator
```

Botium setup is ready, you can begin to write your [BotiumScript](https://botium.atlassian.net/wiki/spaces/BOTIUM/pages/491664/Botium+Scripting+-+BotiumScript) files.

### Use open messaging channel (webhook)

If you set 'OPEN_MESSAGING' value in `GENESYS_MESSAGING_CHANNEL`, then you choose Open messaging channel, which is a webhook based channel.

In Genesys cloud you have to do the following:
* You have to have a `Digital Bot Flow` or a `Bot Flow`, which is connected to an `Inbound Message Flow` under Architect page
* Under `Admin/Message/Platform` menu you have to create a new integration for  `Open Messaging`. You have to add here a webhook URL which is the endpoint to your botium box instance or to `botium-cli inbound-proxy`. (from localhost you can use [ngrok](https://ngrok.com/), see later)
* Under `Admin/Routing/Message` Routing you have to add a new Message route. Select here your `Inbound Message Flow` and add in addresses your `Open Messaging` integration.
* Under `Admin/Integrations/OAuth` create OAuth client credentials with the corresponding roles

After you finished the steps in Genesys you can create a `botium.json` file. (The value for `GENESYS_OPEN_MESSAGING_INTEGRATION_ID` you can find in the url when you open in genesys cloud your open messaging integration for edit)

```
{
  "botium": {
    "Capabilities": {
      "PROJECTNAME": "<whatever>",
      "CONTAINERMODE": "genesys",
      "GENESYS_MESSAGING_CHANNEL": "OPEN_MESSAGING",
      "GENESYS_AWS_REGION": "us-east-1",
      "GENESYS_CLIENT_ID": "5305cdc8-5ef9-49b9-8cbe-95e87bd3c123",
      "GENESYS_CLIENT_SECRET": "vL9kEoHLCb6AWmby5xpHrbAKviL-Lzu6WCiBUZTt123",
      "GENESYS_OPEN_MESSAGING_INTEGRATION_ID": "1387d005-b09a-4788-bf53-16c378cdc111",
      "GENESYS_USER_DATA": {
        "nickname": "Messaging User",
        "id": "messaging-user@externalservice.com",
        "idType": "email",
        "firstName": "Messaging",
        "lastName": "User"
      },
      "SIMPLEREST_INBOUND_REDISURL": "redis://127.0.0.1:6379"
    }
  }
}
```

To check the configuration, run the emulator (Botium CLI required) to bring up a chat interface in your terminal window:

```
> botium-cli emulator
```

Botium setup is ready, you can begin to write your [BotiumScript](https://botium.atlassian.net/wiki/spaces/BOTIUM/pages/491664/Botium+Scripting+-+BotiumScript) files.

## How to start samples

There are some small demo in [samples](./samples) with Botium Bindings.
By changing the corresponding capabilities you can use it with your Genesys bot.

### Genesys web messaging sample

* Install the dependencies and botium-core as peerDependency:
    ```
    > npm install && npm install --no-save botium-core
    ```
* Navigate into the [web messaging sample](./samples/webmessaging) directory
    * Install the dependencies
        ```
        > cd ./samples/webmessaging
        > npm install
        ```
    * Adapt botium.json in the sample directory:
        * Change `GENESYS_AWS_REGION` with your Genesys aws region
        * Change `GENESYS_DEPLOYMENT_ID` with your Messenger Deployment key
    * Finally run the test
        ```
          > npm test
        ```

### Genesys open messaging sample   


* Navigate into the [web messaging sample](./samples/openmessaging) directory
    * Install the dependencies
        ```
        > cd ./samples/openmessaging
        > npm install
        ```
    * Adapt botium.json in the sample directory:
        * Change `GENESYS_AWS_REGION` with your Genesys aws region
        * Change `GENESYS_CLIENT_ID` with your OAuth Client Id
        * Change `GENESYS_CLIENT_SECRET` with your OAuth Client Secret
        * Change `GENESYS_OPEN_MESSAGING_INTEGRATION_ID` with your Open Messaging integration Id
        * Change `GENESYS_USER_DATA` if necessary

    * Start `inbound-proxy` (it will listen on `http://127.0.0.1:45100/`):
      ```
        > npm run inbound
      ```
        * In your open messaging integration in Genesys cloud you need to set `
          SzabiTest
          Outbound Notification Webhook URL` according to the previous step set up inbound-proxy url.
          (To make this localhost url public you can use e.g. [ngrok](https://ngrok.com/))
    * Finally run the test
        ```
          > npm test
        ```

## Supported Capabilities

Set the capability __CONTAINERMODE__ to __genesys__ to activate this connector.

#### GENESYS_AWS_REGION*
You have to specify the AWS region where your Genesys account located

#### GENESYS_MESSAGING_CHANNEL*
You can choose between Web Messaging (WEB_MESSAGING) - websocket and Open Messaging (OPEN_MESSAGING) - webhook channels

#### GENESYS_NLP_ANALYTICS
You can enable NLP analytics by this boolean flag. (false by default)

#### GENESYS_INBOUND_MESSAGE_FLOW_NAME
When you turn on `GENESYS_NLP_ANALYTICS`, then it's required to specify the inbound message flow name.

### WEB MESSAGING

#### GENESYS_DEPLOYMENT_ID*
You have to set the Messenger Deployment key here

### OPEN MESSAGING

#### GENESYS_CLIENT_ID*
Genesys OAuth Client Id

#### GENESYS_CLIENT_SECRET*
Genesys OAuth Client Secret

#### GENESYS_OPEN_MESSAGING_INTEGRATION_ID*
Open Messaging integration Id (you can find it in the browser url)

#### GENESYS_USER_DATA
You can define a user data object.
E.g.:
```
{
    "nickname": "Messaging User",
    "id": "messaging-user02@externalservice.com",
    "idType": "email",
    "firstName": "Messaging",
    "lastName": "User"
}
```
jenkins test
 

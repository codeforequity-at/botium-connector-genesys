import dotenv from 'dotenv'
dotenv.config()
import delay from 'delay'
import { assert } from 'chai'
import BotiumConnectorGenesys from '../../src/connector.js'

const caps = {}

describe('sayhello', function () {
  before(async function () {
    Object.keys(process.env).filter(e => e.startsWith('BOTIUM_')).forEach((element) => {
      const elementToMerge = element.replace(/^BOTIUM_/, '')
      caps[elementToMerge] = process.env[element]
    })
  })
  it('should successfully get an answer for say hello', async function () {
    const messageText = []
    const queueBotSays = (botMsg) => {
      messageText.push(botMsg.messageText)
    }
    const connector = new BotiumConnectorGenesys({ queueBotSays, caps })
    await connector.Validate()
    await connector.Build()
    await connector.Start()
    await connector.UserSays({ messageText: 'Hello' })
    await delay(3000)
    assert.isTrue(messageText.includes('Hello, I\'m Genesys bot for botium testing'))
    await connector.Stop()
    await connector.Clean()
  }).timeout(10000)
})

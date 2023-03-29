require('dotenv').config()
const assert = require('chai').assert
const { importHandler } = require('../../src/intents')
const caps = {}

describe('importhandler', function () {
  before(async function () {
    Object.keys(process.env).filter(e => e.startsWith('BOTIUM_')).forEach((element) => {
      const elementToMerge = element.replace(/^BOTIUM_/, '')
      caps[elementToMerge] = process.env[element]
    })
  })
  it('should successfully download intents', async function () {
    const result = await importHandler({ caps })
    assert.equal(result.convos.length, 0)
    assert.isAbove(result.utterances.length, 0)
    const utterance = result.utterances[0]
    assert.equal(utterance.name, 'BotiumGenesysConnectorTest_Joke')
    assert.isTrue(utterance.utterances.includes('jokes'))
    assert.isTrue(utterance.utterances.includes('Tell me a joke'))
  }).timeout(10000)
})

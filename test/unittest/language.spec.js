const assert = require('chai').assert
const { normalizeLanguage, supportedLanguages, resolveNluDomainVersionId } = require('../../src/intents')
const { getCustomAttributes } = require('../../src/util')

describe('language', function () {
  describe('helpers', function () {
    const multilingualDomainVersion = {
      language: 'en-us',
      languageVersions: {
        'es-es': 'esVersion01',
        'de-de': 'deVersion01'
      }
    }

    it('should normalize languages', async function () {
      assert.equal(normalizeLanguage('es_ES'), 'es-es')
      assert.equal(normalizeLanguage(' es-ES '), 'es-es')
      assert.equal(normalizeLanguage('en_us'), 'en-us')
      assert.isNull(normalizeLanguage(''))
      assert.isNull(normalizeLanguage(undefined))
    })

    it('should collect the supported languages of an nlu domain version', async function () {
      assert.deepEqual(supportedLanguages(multilingualDomainVersion), ['en-us', 'es-es', 'de-de'])
      assert.deepEqual(supportedLanguages({ language: 'en-us' }), ['en-us'])
      assert.deepEqual(supportedLanguages({}), [])
    })

    it('should resolve the nlu domain version of a language', async function () {
      const resolve = (language) => resolveNluDomainVersionId({
        domainVersion: multilingualDomainVersion,
        domainVersionId: 'defaultVersion01',
        language
      })

      assert.equal(resolve(null), 'defaultVersion01')
      assert.equal(resolve('en-us'), 'defaultVersion01')
      assert.equal(resolve('en_US'), 'defaultVersion01')
      assert.equal(resolve('es-es'), 'esVersion01')
      assert.equal(resolve('de-de'), 'deVersion01')
      assert.isNull(resolve('fr-fr'))
    })

    it('should resolve a base language to a full locale', async function () {
      const resolve = (language) => resolveNluDomainVersionId({
        domainVersion: multilingualDomainVersion,
        domainVersionId: 'defaultVersion01',
        language
      })

      assert.equal(resolve('es'), 'esVersion01')
      assert.equal(resolve('en'), 'defaultVersion01')
    })
  })

  describe('custom attributes', function () {
    it('should send the language as custom attribute', async function () {
      assert.deepEqual(getCustomAttributes({ GENESYS_LANGUAGE: 'es-es' }), { language: 'es-es' })
    })

    it('should merge the language into the configured custom attributes', async function () {
      assert.deepEqual(getCustomAttributes({
        GENESYS_LANGUAGE: 'es-es',
        GENESYS_CUSTOM_ATTRIBUTES: { department: 'sales' }
      }), { department: 'sales', language: 'es-es' })
    })

    it('should let a configured custom attribute win over the language capability', async function () {
      assert.deepEqual(getCustomAttributes({
        GENESYS_LANGUAGE: 'es-es',
        GENESYS_CUSTOM_ATTRIBUTES: { language: 'de-de' }
      }), { language: 'de-de' })
    })

    it('should use the configured custom attribute name', async function () {
      assert.deepEqual(getCustomAttributes({
        GENESYS_LANGUAGE: 'es-es',
        GENESYS_LANGUAGE_ATTRIBUTE_NAME: 'conversationLanguage'
      }), { conversationLanguage: 'es-es' })
    })

    it('should not send the language when the attribute name is blank', async function () {
      assert.isNull(getCustomAttributes({
        GENESYS_LANGUAGE: 'es-es',
        GENESYS_LANGUAGE_ATTRIBUTE_NAME: ''
      }))
    })

    it('should send no custom attributes when nothing is configured', async function () {
      assert.isNull(getCustomAttributes({}))
    })
  })
})

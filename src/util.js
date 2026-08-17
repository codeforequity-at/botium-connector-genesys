const { UrlsByRegion, Capabilities, DEFAULT_LANGUAGE_ATTRIBUTE_NAME, DEFAULT_LANGUAGE } = require('./constants')
const _ = require('lodash')
const debug = require('debug')('botium-connector-genesys')

/**
 * Genesys maps custom attributes to participant data. Publishing the language there lets an Architect
 * flow pick it up with a Get Participant Data action and switch the conversation language with a
 * Set Language action, so a single capability drives both NLU detection and the conversation itself.
 *
 * The attribute is always sent, defaulting to DEFAULT_LANGUAGE, because a Set Language action fails
 * on a missing value and the flow then answers nothing at all.
 *
 * @param caps
 * @returns {object|null} the custom attributes to send, or null when there are none
 */
const getCustomAttributes = (caps) => {
  const configuredAttributes = caps[Capabilities.GENESYS_CUSTOM_ATTRIBUTES]
  const configuredLanguage = caps[Capabilities.GENESYS_LANGUAGE]
  const language = configuredLanguage || DEFAULT_LANGUAGE
  const attributeName = _.isNil(caps[Capabilities.GENESYS_LANGUAGE_ATTRIBUTE_NAME])
    ? DEFAULT_LANGUAGE_ATTRIBUTE_NAME
    : caps[Capabilities.GENESYS_LANGUAGE_ATTRIBUTE_NAME]

  if (!attributeName) {
    return configuredAttributes || null
  }
  if (configuredAttributes && !_.isPlainObject(configuredAttributes)) {
    debug(`GENESYS_CUSTOM_ATTRIBUTES is not an object, sending it unchanged without the '${attributeName}' attribute`)
    return configuredAttributes
  }

  const customAttributes = Object.assign({}, configuredAttributes)
  if (_.isNil(customAttributes[attributeName])) {
    customAttributes[attributeName] = language
  } else if (configuredLanguage && customAttributes[attributeName] !== configuredLanguage) {
    debug(`Custom attribute '${attributeName}' is set to '${customAttributes[attributeName]}' and takes precedence over GENESYS_LANGUAGE '${configuredLanguage}'`)
  }
  return customAttributes
}

const getAccessToken = async (awsRegion, clientId, clientSecret) => {
  try {
    const params = new URLSearchParams()
    params.append('grant_type', 'client_credentials')

    const authEndpoint = _.get(UrlsByRegion, `${awsRegion}.auth`)
    const requestOptions = {
      url: `${authEndpoint}/oauth/token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: params
    }
    debug(`Request access token: ${JSON.stringify(requestOptions, null, 2)}`)
    const authResponse = await fetch(requestOptions.url, {
      method: requestOptions.method,
      headers: requestOptions.headers,
      body: requestOptions.body
    })

    if (!authResponse.ok) {
      const errorDetails = await authResponse.text()
      throw new Error(`HTTP error! Status: ${authResponse.status}, Message: ${errorDetails}`)
    }
    const authResult = await authResponse.json()
    return authResult.access_token
  } catch (err) {
    throw new Error(`Failed to get access token: ${err.message}`)
  }
}

module.exports = {
  getAccessToken,
  getCustomAttributes
}

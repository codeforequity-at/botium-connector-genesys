const { UrlsByRegion } = require('./constants')
const _ = require('lodash')
const debug = require('debug')('botium-connector-genesys')

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
  getAccessToken
}

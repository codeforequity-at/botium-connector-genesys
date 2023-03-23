const { UrlsByRegion } = require('./constants')
const qs = require('qs')
const axios = require('axios')
const _ = require('lodash')

const getAccessToken = async (awsRegion, clientId, clientSecret) => {
  try {
    const authEndpoint = _.get(UrlsByRegion, `${awsRegion}.auth`)
    const requestOptions = {
      method: 'post',
      url: `${authEndpoint}/oauth/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      data: qs.stringify({ grant_type: 'client_credentials' })
    }
    const authResult = await axios(requestOptions)
    return authResult.data.access_token
  } catch (err) {
    throw new Error(`Failed to get access token: ${err.message}`)
  }
}

module.exports = {
  getAccessToken
}

// JSON Cleartext Signing
'use strict'

const rsasign = require('jsrsasign') // eslint-disable-line no-unused-vars
const cc = require('five-bells-condition')
const ServerError = require('../errors/server-error')
const _ = require('lodash')
const base64url = require('base64url')

// Constants for crypto algorithm types (ECDSA and RSA)
const ES256 = 'ES256'
const PS256 = 'PS256'
const CC = 'CC'
module.exports.types = {
  ES256,
  PS256,
  CC
}

// If given key is PEM formatted string, convert it to key object
// If it's already key object, just use it
function parseKey (key) {
  if (typeof key === 'string') {
    return rsasign.KEYUTIL.getKey(key)
  } else {
    return key
  }
}

/**
 * Returns a JSON Web Signature (JWS)
 * @param {string} algorithm - The algorithm used to sign the JSON.
 * @param {string} payload - The JSON to verify.
 * @param {Base64URL} signature - The base64URL-encoded signature for the JSON.
 @ @returns {string}
 */
function makeJWSString (algorithm, payload, signature) {
  return base64url.encode(JSON.stringify({alg: algorithm})) + '.' +
    base64url.encode(JSON.stringify(payload)) + '.' +
    signature
}

// Sign JSON object, using ECDSA P-256 private key and public key.
// Insert 'signature' block in the JSON object.
// Warning: there must not be an existing 'signature' block.
module.exports.sign = function (json, cryptoType, prvKey, pubKey) {
  if (cryptoType === ES256) return signECDSA(json, prvKey, pubKey)
  else if (cryptoType === PS256) return signRSA(json, prvKey)
  else if (cryptoType === CC) return signCC(json, prvKey)
  else throw new ServerError('Unsupported crypto algorithm: ' + cryptoType)
}

function signECDSA (json, prvKey, pubKey) {
  if (!prvKey) throw new ServerError('Problem reading private key for JSON signing')
  if (!pubKey) throw new ServerError('Problem reading public key for JSON signing')
  const strJWS = rsasign.jws.JWS.sign('ES256', // eslint-disable-line no-undef
                                   JSON.stringify({alg: 'ES256'}),
                                   JSON.stringify(json),
                                   prvKey)
  const jwsArray = strJWS.split('.')
  // Get x and y coordinates
  const pubKeyHex = pubKey.pubKeyHex
  // According to jsrsasign documentation,
  // pubkey hex length should be 2 (header) + 64 (X) + 64 (Y) = 130.
  // first two chracters must be "04".
  if (pubKeyHex.length !== 130 || !_.startsWith(pubKeyHex, '04')) {
    throw new ServerError('Problem decoding public key for JSON signing')
  }
  const hX = base64url.encode(pubKeyHex.slice(2, 66))
  const hY = base64url.encode(pubKeyHex.slice(66, 130))

  const signedJSON = _.cloneDeep(json)
  signedJSON.signature = {
    'algorithm': 'ES256',
    'publicKey': {
      'type': 'EC',
      'curve': 'P-256',
      'x': hX,
      'y': hY
    },
    'value': jwsArray[2]
  }
  return signedJSON
}

// Sign JSON object using RSA
function signRSA (json, prvKey) {
  if (!prvKey) throw new ServerError('Problem reading private key for JSON signing')
  const prvKeyObj = parseKey(prvKey)
  const strJWS = rsasign.jws.JWS.sign(PS256, // eslint-disable-line no-undef
                                   JSON.stringify({alg: PS256}),
                                   JSON.stringify(json),
                                   prvKeyObj)
  const jwsArray = strJWS.split('.')
  // TODO: To make e and n exactly compliant with JCS spec, E and N must be represented as
  // "Base64URL-encoded positive integer with arbitrary precision."
  // jsrsasign stores public key components "e" as Number, and "n" as BigInteger
  const pubkeyE = base64url.encode(new Buffer(prvKeyObj.e.toString()))
  const pubkeyN = base64url.encode(new Buffer(prvKeyObj.n.toString()))
  const signedJSON = _.cloneDeep(json)
  signedJSON.signature = {
    'algorithm': PS256,
    'publicKey': {
      'type': 'RSA',
      'e': pubkeyE,
      'n': pubkeyN
    },
    'value': jwsArray[2]
  }
  return signedJSON
}

// Sign JSON object using CC
function signCC (json, privateKey) {
  if (!privateKey) throw new ServerError('Problem reading private key for JSON signing')

  let fulfillment
  const message = new Buffer(JSON.stringify(json), 'utf8')
  if (privateKey.indexOf('-----BEGIN RSA PRIVATE KEY-----') === 0) {
    fulfillment = new cc.RsaSha256()
    fulfillment.sign(message, privateKey)
  } else {
    fulfillment = new cc.Ed25519()
    fulfillment.sign(message, new Buffer(privateKey, 'base64'))
  }

  const signedJson = _.cloneDeep(json)
  signedJson.signature = {
    algorithm: CC,
    value: cc.base64url.encode(fulfillment.serializeBinary())
  }

  return signedJson
}

// Verify 'signature' block on the input JSON object has the correct signature value.
module.exports.verify = function (json, pubKey) {
  if (!json || !json.signature || !json.signature.value) {
    return {valid: false, error: 'Invalid input'}
  }

  if (!pubKey) {
    return {valid: false, error: 'Missing public key'}
  }

  const algorithm = json.signature.algorithm

  let valid = false
  let error
  try {
    if (algorithm === ES256) {
      valid = verifyECDSA(json, pubKey)
    } else if (algorithm === PS256) {
      valid = verifyRSA(json, pubKey)
    } else if (algorithm === CC) {
      valid = verifyCC(json, pubKey)
    } else {
      valid = false
      error = 'Unsupported crypto algorithm'
    }
  } catch (e) {
    valid = false
    error = e.message
  }

  return {valid: valid, error: error}
}

function verifyECDSA (json, pubKey) {
  // check pub key coordinates X and Y in signature
  const pubKeyHex = pubKey.pubKeyHex
  // According to jsrsasign documentation,
  // pubkey hex length should be 2 (header) + 64 (X) + 64 (Y) = 130.
  // first two chracters must be "04".
  if (pubKeyHex.length !== 130 || !_.startsWith(pubKeyHex, '04')) {
    throw new ServerError('Problem decoding public key for JSON signature verification')
  }
  const hX = base64url.encode(pubKeyHex.slice(2, 66))
  const hY = base64url.encode(pubKeyHex.slice(66, 130))
  if (json.signature.publicKey.x !== hX || json.signature.publicKey.y !== hY) {
    throw new ServerError('Public key mismatch in JSON signature verification')
  }

  const jws = makeJWSString(ES256, _.omit(json, 'signature'), json.signature.value)
  return rsasign.jws.JWS.verify(jws, pubKey) // eslint-disable-line no-undef
}

function verifyRSA (json, pubKey) {
  const pubKeyObj = parseKey(pubKey)
  // Check pub key parameters
  const pubkeyE = base64url.encode(new Buffer(pubKeyObj.e.toString()))
  const pubkeyN = base64url.encode(new Buffer(pubKeyObj.n.toString()))
  if (json.signature.publicKey.e !== pubkeyE || json.signature.publicKey.n !== pubkeyN) {
    throw new ServerError('Public key mismatch in JSON signature verification')
  }

  const jws = makeJWSString(PS256, _.omit(json, 'signature'), json.signature.value)
  return rsasign.jws.JWS.verify(jws, pubKeyObj, [PS256]) // eslint-disable-line no-undef
}

function verifyCC (json, pubKey) {
  const fulfillment = cc.fromFulfillmentBinary(new Buffer(json.signature.value, 'base64'))
  const message = new Buffer(JSON.stringify(_.omit(json, 'signature')), 'utf8')
  return cc.validateFulfillment(fulfillment, pubKey, message)
}

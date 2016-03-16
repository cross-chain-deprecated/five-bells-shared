'use strict'

// Test jsonSigning utility

const chai = require('chai')
const expect = chai.expect
const jsonSigning = require('../utils/jsonSigning')
const rsasign = require('jsrsasign')
const signData = require('./data/signData')
const fs = require('fs')
const ServerError = require('../errors/server-error')

// Set up keys
const prvPEM = fs.readFileSync('test/data/signKeyPrv.pem', 'utf8')
const pubPEM = fs.readFileSync('test/data/signKeyPub.pem', 'utf8')
const prvKey = rsasign.KEYUTIL.getKey(prvPEM, 'pass', 'AES-256-CBC')
const pubKey = rsasign.KEYUTIL.getKey(pubPEM, 'PKCS8PUB')

describe('jsonSigningTests', function () {
  describe('jsonSigning', function () {
    it('should sign JSON object successfully', function () {
      const signedJSON = jsonSigning.sign(signData.sampleNotification, prvKey, pubKey)
      // Do not check signature.value, because this value changes every time it signs
      delete signedJSON.signature.value
      expect(signedJSON).to.deep.equal(signData.expectedSignedNotification)
    })
  })

  describe('jsonSignAndVerify', function () {
    it('should sign and verify JSON object successfully', function () {
      const signedJSON = jsonSigning.sign(signData.sampleNotification, prvKey, pubKey)
      const result = jsonSigning.verify(signedJSON, pubKey)
      expect(result).to.be.true
    })
  })

  describe('jsonInvalidSignature', function () {
    it('should catch invalid JSON signature', function () {
      const signedJSON = jsonSigning.sign(signData.sampleNotification, prvKey, pubKey)
      // Modify signature value to make verification fail
      signedJSON.signature.value += 'X'
      const result = jsonSigning.verify(signedJSON, pubKey)
      expect(result).to.be.false
    })
  })

  describe('jsonInvalidPublicKey', function () {
    it('should catch invalid public key in signed JSON', function () {
      const signedJSON = jsonSigning.sign(signData.sampleNotification, prvKey, pubKey)
      // Modify public key in signature to make verification throw error
      signedJSON.signature.publicKey.y += 'X'
      expect(function () {
        jsonSigning.verify(signedJSON, pubKey)
      }).to.throw(ServerError)
    })
  })
})
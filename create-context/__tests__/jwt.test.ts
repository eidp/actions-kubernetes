import { describe, it, expect } from 'vitest'
import { parseJWTClaims } from '../src/jwt.js'

describe('JWT parsing', () => {
  it('should parse valid JWT token', () => {
    // Valid JWT: header.payload.signature
    const mockPayload = {
      sub: '1234567890',
      name: 'Test User',
      iat: 1516239022
    }
    const payloadBase64 = btoa(JSON.stringify(mockPayload))
    const mockToken = `header.${payloadBase64}.signature`

    const claims = parseJWTClaims(mockToken)

    expect(claims).toEqual(mockPayload)
  })

  it('should throw error for invalid JWT format', () => {
    const invalidToken = 'invalid.token'

    expect(() => parseJWTClaims(invalidToken)).toThrow('Invalid JWT format')
  })

  it('should throw error for malformed payload', () => {
    const invalidToken = 'header.not-valid-base64!!!.signature'

    expect(() => parseJWTClaims(invalidToken)).toThrow('Failed to parse JWT')
  })

  it('should handle JWT with special characters in payload', () => {
    const mockPayload = {
      sub: 'repo:owner/repo:ref:refs/heads/main',
      aud: 'kubernetes',
      iss: 'https://token.actions.githubusercontent.com'
    }
    const payloadBase64 = Buffer.from(JSON.stringify(mockPayload)).toString(
      'base64'
    )
    const mockToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payloadBase64}.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`

    const claims = parseJWTClaims(mockToken)

    expect(claims).toEqual(mockPayload)
  })
})

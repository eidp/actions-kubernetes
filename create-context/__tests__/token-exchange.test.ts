import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exchangeToken } from '../src/token-exchange.js'

describe('Token exchange', () => {
  const mockFetch = vi.fn()
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('should exchange token successfully', async () => {
    const mockAccessToken = 'exchanged-access-token'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: mockAccessToken,
        token_type: 'Bearer',
        expires_in: 300
      })
    })

    const result = await exchangeToken({
      endpoint: 'https://login.eidp.io/realms/eidp',
      clientId: 'github-actions.eidp.io',
      clientSecret: 'test-secret',
      subjectToken: 'github-oidc-token'
    })

    expect(result).toBe(mockAccessToken)
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe(
      'https://login.eidp.io/realms/eidp/protocol/openid-connect/token'
    )
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    )

    const body = new URLSearchParams(options.body)
    expect(body.get('client_id')).toBe('github-actions.eidp.io')
    expect(body.get('client_secret')).toBe('test-secret')
    expect(body.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:token-exchange'
    )
    expect(body.get('subject_token')).toBe('github-oidc-token')
    expect(body.get('subject_issuer')).toBe('github-actions')
    expect(body.get('subject_token_type')).toBe(
      'urn:ietf:params:oauth:token-type:jwt'
    )
    expect(body.get('requested_token_type')).toBe(
      'urn:ietf:params:oauth:token-type:access_token'
    )
    expect(body.get('audience')).toBe('kubernetes.eidp.io')
  })

  it('should throw error on HTTP error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid client credentials'
    })

    await expect(
      exchangeToken({
        endpoint: 'https://login.eidp.io/realms/eidp',
        clientId: 'github-actions.eidp.io',
        clientSecret: 'wrong-secret',
        subjectToken: 'github-oidc-token'
      })
    ).rejects.toThrow('Token exchange failed: 401 Unauthorized')
  })

  it('should throw error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      exchangeToken({
        endpoint: 'https://login.eidp.io/realms/eidp',
        clientId: 'github-actions.eidp.io',
        clientSecret: 'test-secret',
        subjectToken: 'github-oidc-token'
      })
    ).rejects.toThrow('Network error')
  })

  it('should throw error when response lacks access_token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token_type: 'Bearer',
        expires_in: 300
      })
    })

    await expect(
      exchangeToken({
        endpoint: 'https://login.eidp.io/realms/eidp',
        clientId: 'github-actions.eidp.io',
        clientSecret: 'test-secret',
        subjectToken: 'github-oidc-token'
      })
    ).rejects.toThrow('Token exchange response missing access_token')
  })
})

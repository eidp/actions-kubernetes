export interface TokenExchangeParams {
  endpoint: string
  clientId: string
  clientSecret: string
  subjectToken: string
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export async function exchangeToken(
  params: TokenExchangeParams
): Promise<string> {
  const tokenUrl = `${params.endpoint}/protocol/openid-connect/token`

  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: params.subjectToken,
    subject_issuer: 'github-actions',
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: 'kubernetes.eidp.io'
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })

  if (!response.ok) {
    throw new Error(
      `Token exchange failed: ${response.status} ${response.statusText}`
    )
  }

  const data = (await response.json()) as TokenResponse

  if (!data.access_token) {
    throw new Error('Token exchange response missing access_token')
  }

  return data.access_token
}

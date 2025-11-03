export interface JWTClaims {
  [key: string]: unknown
}

export function parseJWTClaims(token: string): JWTClaims {
  const parts = token.split('.')

  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: token must have 3 parts')
  }

  try {
    const payload = atob(parts[1])
    return JSON.parse(payload)
  } catch (error) {
    throw new Error(`Failed to parse JWT: ${error}`)
  }
}

/**
 * Parse age string to seconds
 * @param ageStr - Age string in format like '7d', '48h', or '30m'
 * @returns Age in seconds
 */
export function parseAgeToSeconds(ageStr: string): number {
  const dayMatch = ageStr.match(/^(\d+)d$/)
  if (dayMatch) {
    return parseInt(dayMatch[1], 10) * 86400
  }

  const hourMatch = ageStr.match(/^(\d+)h$/)
  if (hourMatch) {
    return parseInt(hourMatch[1], 10) * 3600
  }

  const minMatch = ageStr.match(/^(\d+)m$/)
  if (minMatch) {
    return parseInt(minMatch[1], 10) * 60
  }

  throw new Error(
    `Invalid age format: ${ageStr}. Use format like 7d, 48h, or 30m`
  )
}

/**
 * Calculate age in seconds from a timestamp
 * @param createdTimestamp - ISO timestamp string
 * @returns Age in seconds
 */
export function calculateAge(createdTimestamp: string): number {
  const created = new Date(createdTimestamp).getTime()
  const now = Date.now()
  return Math.floor((now - created) / 1000)
}

/**
 * Format age in seconds to human-readable string
 * @param ageSeconds - Age in seconds
 * @returns Formatted age string like '2d 3h' or '5h 30m'
 */
export function formatAge(ageSeconds: number): string {
  const days = Math.floor(ageSeconds / 86400)
  const hours = Math.floor((ageSeconds % 86400) / 3600)
  const minutes = Math.floor((ageSeconds % 3600) / 60)

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Parse timeout string to milliseconds using parse-duration
 * @param timeout - Timeout string (e.g., '5m', '30s', '2h')
 * @returns Timeout in milliseconds, defaults to 5 minutes if parsing fails
 */
export function parseTimeout(timeout: string): number {
  // Use dynamic import to avoid adding parse-duration to shared package if not needed
  // For now, we'll use a simple implementation that matches common patterns
  const match = timeout.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) {
    return 300000 // Default to 5 minutes
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    default:
      return 300000 // Default to 5 minutes
  }
}

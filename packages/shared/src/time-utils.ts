import parse from 'parse-duration'

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
 * Parse duration string to milliseconds
 * @param duration - Duration string (e.g., '3m', '180s', '1h30m', '7h3m45s')
 * @returns Duration in milliseconds
 * @throws Error if duration format is invalid or negative
 */
export function parseDuration(duration: string): number {
  const result = parse(duration)

  if (result === null || result === undefined) {
    throw new Error(
      `Invalid duration format: ${duration}. Expected format: duration string (e.g., 3m, 180s, 1h30m, 7h3m45s)`
    )
  }

  if (result < 0) {
    throw new Error(
      `Invalid duration: ${duration}. Duration cannot be negative`
    )
  }

  return result
}

/**
 * Parse timeout string to milliseconds with default fallback
 * @param timeout - Timeout string (e.g., '5m', '30s', '2h')
 * @returns Timeout in milliseconds, defaults to 5 minutes if parsing fails
 */
export function parseTimeout(timeout: string): number {
  try {
    return parseDuration(timeout)
  } catch {
    return 300000 // Default to 5 minutes
  }
}

import parse from 'parse-duration'

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

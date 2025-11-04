import { describe, it, expect } from 'vitest'
import {
  parseAgeToSeconds,
  calculateAge,
  formatAge
} from '../src/time-utils.js'

describe('parseAgeToSeconds', () => {
  it('should parse days correctly', () => {
    expect(parseAgeToSeconds('1d')).toBe(86400)
    expect(parseAgeToSeconds('7d')).toBe(604800)
    expect(parseAgeToSeconds('30d')).toBe(2592000)
  })

  it('should parse hours correctly', () => {
    expect(parseAgeToSeconds('1h')).toBe(3600)
    expect(parseAgeToSeconds('24h')).toBe(86400)
    expect(parseAgeToSeconds('48h')).toBe(172800)
  })

  it('should parse minutes correctly', () => {
    expect(parseAgeToSeconds('1m')).toBe(60)
    expect(parseAgeToSeconds('30m')).toBe(1800)
    expect(parseAgeToSeconds('60m')).toBe(3600)
  })

  it('should throw error for invalid format', () => {
    expect(() => parseAgeToSeconds('invalid')).toThrow('Invalid age format')
    expect(() => parseAgeToSeconds('7')).toThrow('Invalid age format')
    expect(() => parseAgeToSeconds('7 days')).toThrow('Invalid age format')
    expect(() => parseAgeToSeconds('7D')).toThrow('Invalid age format')
  })

  it('should handle edge cases', () => {
    expect(parseAgeToSeconds('0d')).toBe(0)
    expect(parseAgeToSeconds('0h')).toBe(0)
    expect(parseAgeToSeconds('0m')).toBe(0)
  })
})

describe('calculateAge', () => {
  it('should calculate age from ISO timestamp', () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString()
    const age = calculateAge(oneHourAgo)
    expect(age).toBeGreaterThanOrEqual(3599)
    expect(age).toBeLessThanOrEqual(3601)
  })

  it('should handle timestamps from days ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400 * 1000).toISOString()
    const age = calculateAge(twoDaysAgo)
    expect(age).toBeGreaterThanOrEqual(172799)
    expect(age).toBeLessThanOrEqual(172801)
  })

  it('should return 0 for current time', () => {
    const now = new Date().toISOString()
    const age = calculateAge(now)
    expect(age).toBeLessThanOrEqual(1)
  })
})

describe('formatAge', () => {
  it('should format days and hours', () => {
    expect(formatAge(172800)).toBe('2d 0h')
    expect(formatAge(176400)).toBe('2d 1h')
    expect(formatAge(259200)).toBe('3d 0h')
  })

  it('should format hours and minutes', () => {
    expect(formatAge(3600)).toBe('1h 0m')
    expect(formatAge(3900)).toBe('1h 5m')
    expect(formatAge(7200)).toBe('2h 0m')
  })

  it('should format only minutes when less than an hour', () => {
    expect(formatAge(60)).toBe('1m')
    expect(formatAge(1800)).toBe('30m')
    expect(formatAge(3540)).toBe('59m')
  })

  it('should handle zero', () => {
    expect(formatAge(0)).toBe('0m')
  })

  it('should handle large values', () => {
    expect(formatAge(604800)).toBe('7d 0h')
    expect(formatAge(691200)).toBe('8d 0h')
  })
})

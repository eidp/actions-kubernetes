import { describe, it, expect } from 'vitest'
import {
  sanitizeName,
  sanitizeLabelValue
} from '@actions-kubernetes/shared/string-utils'
import {
  parseAgeToSeconds,
  calculateAge,
  formatAge
} from '@actions-kubernetes/shared/time-utils'
import { reconstructCiPrefix, getCiPrefixLabel } from '../src/utils'

describe('sanitizeName', () => {
  it('should convert to lowercase', () => {
    expect(sanitizeName('MyName')).toBe('myname')
  })

  it('should remove non-alphanumeric characters except hyphens', () => {
    expect(sanitizeName('my_name@123')).toBe('myname123')
  })

  it('should keep hyphens', () => {
    expect(sanitizeName('my-name-123')).toBe('my-name-123')
  })

  it('should handle mixed case and special characters', () => {
    expect(sanitizeName('PR#123_Branch/Name')).toBe('pr123branchname')
  })
})

describe('sanitizeLabelValue', () => {
  it('should convert to lowercase', () => {
    expect(sanitizeLabelValue('MyRepo')).toBe('myrepo')
  })

  it('should replace forward slashes with underscores', () => {
    expect(sanitizeLabelValue('owner/repo')).toBe('owner_repo')
  })

  it('should keep hyphens, underscores, and dots', () => {
    expect(sanitizeLabelValue('my-repo_name.v1')).toBe('my-repo_name.v1')
  })

  it('should replace invalid characters with underscores', () => {
    expect(sanitizeLabelValue('repo@123#name')).toBe('repo_123_name')
  })

  it('should remove leading non-alphanumeric characters', () => {
    expect(sanitizeLabelValue('---repo')).toBe('repo')
    expect(sanitizeLabelValue('___repo')).toBe('repo')
    expect(sanitizeLabelValue('...repo')).toBe('repo')
  })

  it('should remove trailing non-alphanumeric characters', () => {
    expect(sanitizeLabelValue('repo---')).toBe('repo')
    expect(sanitizeLabelValue('repo___')).toBe('repo')
    expect(sanitizeLabelValue('repo...')).toBe('repo')
  })

  it('should handle both leading and trailing non-alphanumeric characters', () => {
    expect(sanitizeLabelValue('--repo--')).toBe('repo')
    expect(sanitizeLabelValue('__owner_repo__')).toBe('owner_repo')
  })

  it('should truncate to 63 characters', () => {
    const longValue =
      'very-long-repository-name-that-exceeds-the-maximum-length-of-63-characters'
    const result = sanitizeLabelValue(longValue)
    expect(result.length).toBeLessThanOrEqual(63)
    expect(result).toBe(
      'very-long-repository-name-that-exceeds-the-maximum-length-of-63'
    )
  })

  it('should remove trailing non-alphanumeric after truncation', () => {
    const longValue = 'a'.repeat(60) + '-extra-content'
    const result = sanitizeLabelValue(longValue)
    expect(result.length).toBeLessThanOrEqual(63)
    expect(result).toBe('a'.repeat(60) + '-ex')
  })

  it('should handle repository names like owner/repo', () => {
    expect(sanitizeLabelValue('eidp/actions-kubernetes')).toBe(
      'eidp_actions-kubernetes'
    )
  })

  it('should handle edge case with trailing hyphen in repo name', () => {
    expect(sanitizeLabelValue('owner/repo-')).toBe('owner_repo')
  })
})

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

describe('reconstructCiPrefix', () => {
  it('should create ci-prefix with correct length', () => {
    expect(reconstructCiPrefix('123456789', 5)).toBe('ci-12345-')
    expect(reconstructCiPrefix('abcdefgh', 8)).toBe('ci-abcdefgh-')
  })

  it('should sanitize the reference', () => {
    expect(reconstructCiPrefix('PR#123', 6)).toBe('ci-pr123-')
    expect(reconstructCiPrefix('Feature_Branch', 10)).toBe('ci-featurebr-')
  })

  it('should handle references shorter than prefix length', () => {
    expect(reconstructCiPrefix('12', 10)).toBe('ci-12-')
    expect(reconstructCiPrefix('a', 5)).toBe('ci-a-')
  })

  it('should throw error if prefix length exceeds 24', () => {
    expect(() => reconstructCiPrefix('reference', 25)).toThrow(
      "The 'ci-prefix-length' input cannot be greater than 24"
    )
    expect(() => reconstructCiPrefix('reference', 100)).toThrow(
      "The 'ci-prefix-length' input cannot be greater than 24"
    )
  })

  it('should handle maximum allowed prefix length', () => {
    expect(reconstructCiPrefix('1234567890123456789012345', 24)).toBe(
      'ci-123456789012345678901234-'
    )
  })
})

describe('getCiPrefixLabel', () => {
  it('should remove trailing hyphens', () => {
    expect(getCiPrefixLabel('ci-12345-')).toBe('ci-12345')
    expect(getCiPrefixLabel('ci-abc--')).toBe('ci-abc')
  })

  it('should handle no trailing hyphens', () => {
    expect(getCiPrefixLabel('ci-12345')).toBe('ci-12345')
  })

  it('should handle multiple trailing hyphens', () => {
    expect(getCiPrefixLabel('ci-12345---')).toBe('ci-12345')
  })

  it('should not remove hyphens in the middle', () => {
    expect(getCiPrefixLabel('ci-12-34-5-')).toBe('ci-12-34-5')
  })
})

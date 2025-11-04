import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import {
  sanitizeName,
  sanitizeLabelValue,
  truncateName
} from '../src/string-utils.js'

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

describe('truncateName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'warning').mockImplementation(() => {})
  })

  it('should not truncate names shorter than max length', () => {
    const name = 'short-name'
    expect(truncateName(name)).toBe(name)
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('should not truncate names equal to max length', () => {
    const name = 'a'.repeat(63)
    expect(truncateName(name)).toBe(name)
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('should truncate names longer than default max length (63)', () => {
    const name = 'a'.repeat(70)
    const result = truncateName(name)
    expect(result).toBe('a'.repeat(63))
    expect(result.length).toBe(63)
    expect(core.warning).toHaveBeenCalledWith(
      `Name truncated to 63 characters: ${name}`
    )
  })

  it('should truncate names to custom max length', () => {
    const name = 'this-is-a-very-long-name'
    const result = truncateName(name, 10)
    expect(result).toBe('this-is-a-')
    expect(result.length).toBe(10)
    expect(core.warning).toHaveBeenCalledWith(
      `Name truncated to 10 characters: ${name}`
    )
  })

  it('should handle empty string', () => {
    expect(truncateName('')).toBe('')
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('should handle single character name', () => {
    expect(truncateName('a')).toBe('a')
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('should log warning with full original name', () => {
    const longName = 'x'.repeat(100)
    truncateName(longName, 20)
    expect(core.warning).toHaveBeenCalledWith(
      `Name truncated to 20 characters: ${longName}`
    )
  })
})

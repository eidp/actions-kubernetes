import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as github from '@actions/github'
import * as core from '@actions/core'
import {
  getPRNumber,
  getWorkflowRunUrl,
  getPRDetails
} from '../src/pr-utils.js'

describe('pr-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'debug').mockImplementation(() => {})
  })

  describe('getPRNumber', () => {
    it('should return PR number from issue context', () => {
      Object.defineProperty(github, 'context', {
        value: {
          issue: { number: 42 }
        },
        writable: true,
        configurable: true
      })

      const result = getPRNumber()

      expect(result).toBe(42)
      expect(core.debug).toHaveBeenCalledWith(
        'PR number from pull_request or issue_comment event'
      )
    })

    it('should return null when no issue context', () => {
      Object.defineProperty(github, 'context', {
        value: {
          issue: {}
        },
        writable: true,
        configurable: true
      })

      const result = getPRNumber()

      expect(result).toBeNull()
    })

    it('should return null when issue context is undefined', () => {
      Object.defineProperty(github, 'context', {
        value: {},
        writable: true,
        configurable: true
      })

      const result = getPRNumber()

      expect(result).toBeNull()
    })
  })

  describe('getWorkflowRunUrl', () => {
    it('should construct workflow run URL', () => {
      Object.defineProperty(github, 'context', {
        value: {
          serverUrl: 'https://github.com',
          repo: { owner: 'test-owner', repo: 'test-repo' },
          runId: 12345
        },
        writable: true,
        configurable: true
      })

      const result = getWorkflowRunUrl()

      expect(result).toBe(
        'https://github.com/test-owner/test-repo/actions/runs/12345'
      )
    })

    it('should handle custom GitHub server URL', () => {
      Object.defineProperty(github, 'context', {
        value: {
          serverUrl: 'https://github.enterprise.com',
          repo: { owner: 'org', repo: 'project' },
          runId: 99999
        },
        writable: true,
        configurable: true
      })

      const result = getWorkflowRunUrl()

      expect(result).toBe(
        'https://github.enterprise.com/org/project/actions/runs/99999'
      )
    })
  })

  describe('getPRDetails', () => {
    beforeEach(() => {
      Object.defineProperty(github, 'context', {
        value: {
          repo: { owner: 'test-owner', repo: 'test-repo' }
        },
        writable: true,
        configurable: true
      })
    })

    it('should fetch PR details from GitHub API', async () => {
      const mockOctokit = {
        rest: {
          pulls: {
            get: vi.fn().mockResolvedValue({
              data: {
                head: {
                  sha: 'abc123def456',
                  ref: 'feature/test-branch'
                }
              }
            })
          }
        }
      }

      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      const result = await getPRDetails('fake-token', 42)

      expect(result).toEqual({
        sha: 'abc123def456',
        branch: 'feature/test-branch'
      })

      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42
      })
    })

    it('should handle different PR numbers', async () => {
      const mockOctokit = {
        rest: {
          pulls: {
            get: vi.fn().mockResolvedValue({
              data: {
                head: {
                  sha: '789xyz',
                  ref: 'fix/bug-123'
                }
              }
            })
          }
        }
      }

      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      const result = await getPRDetails('fake-token', 999)

      expect(result.sha).toBe('789xyz')
      expect(result.branch).toBe('fix/bug-123')
    })

    it('should propagate API errors', async () => {
      const mockOctokit = {
        rest: {
          pulls: {
            get: vi.fn().mockRejectedValue(new Error('API error'))
          }
        }
      }

      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      await expect(getPRDetails('fake-token', 42)).rejects.toThrow('API error')
    })
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as github from '@actions/github'
import * as core from '@actions/core'
import {
  detectSlashCommand,
  checkPermissions,
  rejectUnauthorised,
  addReaction
} from '../src/slash-commands'

describe('detectSlashCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset github.context to a clean state
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'pull_request',
        payload: {},
        issue: {},
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })
  })

  it('should return shouldExecute=true for non-issue_comment events', async () => {
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'pull_request',
        payload: {},
        issue: {},
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await detectSlashCommand('deploy')

    expect(result.isSlashCommand).toBe(false)
    expect(result.shouldExecute).toBe(true)
    expect(result.command).toBeNull()
  })

  it('should return shouldExecute=false for issue comments (not PR comments)', async () => {
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'issue_comment',
        payload: {
          issue: {},
          comment: { id: 123, body: '/deploy', user: { login: 'testuser' } }
        },
        issue: { number: 1 },
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await detectSlashCommand('deploy')

    expect(result.isSlashCommand).toBe(true)
    expect(result.shouldExecute).toBe(false)
  })

  it('should return shouldExecute=false when no slash command found', async () => {
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'issue_comment',
        payload: {
          issue: { pull_request: {} },
          comment: {
            id: 123,
            body: 'Just a regular comment',
            user: { login: 'testuser' }
          }
        },
        issue: { number: 1 },
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await detectSlashCommand('deploy')

    expect(result.isSlashCommand).toBe(true)
    expect(result.shouldExecute).toBe(false)
  })

  it('should return shouldExecute=false when command does not match', async () => {
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'issue_comment',
        payload: {
          issue: { pull_request: {} },
          comment: {
            id: 123,
            body: '/teardown',
            user: { login: 'testuser' }
          }
        },
        issue: { number: 1 },
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await detectSlashCommand('deploy')

    expect(result.isSlashCommand).toBe(true)
    expect(result.command).toBe('teardown')
    expect(result.shouldExecute).toBe(false)
  })

  it('should return shouldExecute=true when command matches', async () => {
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'issue_comment',
        payload: {
          issue: { pull_request: {} },
          comment: { id: 123, body: '/deploy', user: { login: 'testuser' } }
        },
        issue: { number: 42 },
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await detectSlashCommand('deploy')

    expect(result.isSlashCommand).toBe(true)
    expect(result.command).toBe('deploy')
    expect(result.shouldExecute).toBe(true)
    expect(result.prNumber).toBe(42)
    expect(result.commentId).toBe(123)
    expect(result.commenter).toBe('testuser')
  })

  it('should handle slash command with multiline comment', async () => {
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'issue_comment',
        payload: {
          issue: { pull_request: {} },
          comment: {
            id: 123,
            body: 'Some text before\n/deploy\nSome text after',
            user: { login: 'testuser' }
          }
        },
        issue: { number: 1 },
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await detectSlashCommand('deploy')

    expect(result.command).toBe('deploy')
    expect(result.shouldExecute).toBe(true)
  })

  it('should handle case-insensitive commands', async () => {
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'issue_comment',
        payload: {
          issue: { pull_request: {} },
          comment: { id: 123, body: '/DEPLOY', user: { login: 'testuser' } }
        },
        issue: { number: 1 },
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await detectSlashCommand('deploy')

    expect(result.command).toBe('deploy')
    expect(result.shouldExecute).toBe(true)
  })
})

describe('checkPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'warning').mockImplementation(() => {})
  })

  it('should return true for users with write access', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({
            data: { permission: 'write' }
          })
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    Object.defineProperty(github, 'context', {
      value: {
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })

    const result = await checkPermissions('fake-token', 'testuser')

    expect(result).toBe(true)
  })

  it('should return true for users with admin access', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({
            data: { permission: 'admin' }
          })
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    const result = await checkPermissions('fake-token', 'testuser')

    expect(result).toBe(true)
  })

  it('should return false for users with read access', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({
            data: { permission: 'read' }
          })
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    const result = await checkPermissions('fake-token', 'testuser')

    expect(result).toBe(false)
  })

  it('should return false on API errors', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getCollaboratorPermissionLevel: vi
            .fn()
            .mockRejectedValue(new Error('API error'))
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    const result = await checkPermissions('fake-token', 'testuser')

    expect(result).toBe(false)
    expect(core.warning).toHaveBeenCalled()
  })
})

describe('addReaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'warning').mockImplementation(() => {})
    Object.defineProperty(github, 'context', {
      value: {
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })
  })

  it('should add reaction successfully', async () => {
    const mockOctokit = {
      rest: {
        reactions: {
          createForIssueComment: vi.fn().mockResolvedValue({})
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    await addReaction('fake-token', 123, '+1')

    expect(
      mockOctokit.rest.reactions.createForIssueComment
    ).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 123,
      content: '+1'
    })
  })

  it('should handle API errors gracefully', async () => {
    const mockOctokit = {
      rest: {
        reactions: {
          createForIssueComment: vi
            .fn()
            .mockRejectedValue(new Error('API error'))
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    await addReaction('fake-token', 123, 'eyes')

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to add reaction')
    )
  })
})

describe('rejectUnauthorised', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'warning').mockImplementation(() => {})
    vi.spyOn(core, 'setFailed').mockImplementation(() => {})
    Object.defineProperty(github, 'context', {
      value: {
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })
  })

  it('should post comment and add reaction', async () => {
    const mockOctokit = {
      rest: {
        issues: {
          createComment: vi.fn().mockResolvedValue({})
        },
        reactions: {
          createForIssueComment: vi.fn().mockResolvedValue({})
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    await rejectUnauthorised('fake-token', 42, 123, 'testuser')

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      body: expect.stringContaining('Permission denied')
    })

    expect(
      mockOctokit.rest.reactions.createForIssueComment
    ).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 123,
      content: '-1'
    })

    expect(core.setFailed).toHaveBeenCalled()
  })

  it('should handle errors and re-throw', async () => {
    const mockOctokit = {
      rest: {
        issues: {
          createComment: vi.fn().mockRejectedValue(new Error('API error'))
        },
        reactions: {
          createForIssueComment: vi.fn().mockResolvedValue({})
        }
      }
    }

    vi.spyOn(github, 'getOctokit').mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof github.getOctokit>
    )

    await expect(
      rejectUnauthorised('fake-token', 42, 123, 'testuser')
    ).rejects.toThrow('API error')

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post permission denied message')
    )
  })
})

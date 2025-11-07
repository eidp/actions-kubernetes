import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  DeploymentCommentManager,
  DeploymentStatus
} from '../src/deployment-comment-manager.js'
import { TeardownReason } from '../src/constants.js'

interface MockOctokit {
  graphql: ReturnType<typeof vi.fn>
  paginate: ReturnType<typeof vi.fn>
  rest: {
    issues: {
      createComment: ReturnType<typeof vi.fn>
      updateComment: ReturnType<typeof vi.fn>
      listComments: ReturnType<typeof vi.fn>
    }
  }
}

describe('DeploymentCommentManager', () => {
  let mockOctokit: MockOctokit

  const mockExistingComment = {
    id: 888,
    node_id: 'node-888',
    body: '<!-- actions-kubernetes: pr=42, workflow=Test Workflow, commit=abc123def -->'
  }

  const mockOldComment = {
    id: 111,
    node_id: 'node-111',
    body: '<!-- actions-kubernetes: pr=42, workflow=Test Workflow, commit=oldsha -->'
  }

  const mockCurrentComment = {
    id: 222,
    node_id: 'node-222',
    body: '<!-- actions-kubernetes: pr=42, workflow=Test Workflow, commit=abc123def -->'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'debug').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'warning').mockImplementation(() => {})

    Object.defineProperty(github, 'context', {
      value: {
        workflow: 'Test Workflow',
        repo: { owner: 'test-owner', repo: 'test-repo' },
        serverUrl: 'https://github.com',
        runId: 12345
      },
      writable: true,
      configurable: true
    })

    mockOctokit = {
      graphql: vi.fn(),
      paginate: vi.fn(),
      rest: {
        issues: {
          createComment: vi.fn(),
          updateComment: vi.fn(),
          listComments: vi.fn()
        }
      }
    }
  })

  describe('constructor', () => {
    it('should initialize with token, PR number, and commit SHA', () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      expect(github.getOctokit).toHaveBeenCalledWith('fake-token')
      expect(manager).toBeInstanceOf(DeploymentCommentManager)
    })

    it('should handle missing token', () => {
      const manager = new DeploymentCommentManager('', 42, 'abc123def')

      expect(core.debug).toHaveBeenCalledWith(
        'No GitHub token provided, comment manager will no-op'
      )
      expect(manager).toBeInstanceOf(DeploymentCommentManager)
    })

    it('should handle null PR number', () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      const manager = new DeploymentCommentManager('fake-token', null, 'abc123')

      expect(manager).toBeInstanceOf(DeploymentCommentManager)
    })
  })

  describe('createOrUpdateDeploymentComment', () => {
    it('should skip when no token provided', async () => {
      const manager = new DeploymentCommentManager('', 42, 'abc123')

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Deployed, {
        environment: 'preview-123'
      })

      expect(core.debug).toHaveBeenCalledWith(
        'Skipping PR comment - no token or no PR context'
      )
    })

    it('should skip when no PR number', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      const manager = new DeploymentCommentManager('fake-token', null, 'abc123')

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Deployed, {
        environment: 'preview-123'
      })

      expect(core.debug).toHaveBeenCalledWith(
        'Skipping PR comment - no token or no PR context'
      )
    })

    it('should create new comment when none exists', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({
        data: { id: 999 }
      })

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Deployed, {
        environment: 'preview-123',
        namespace: 'test-ns'
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 42,
        body: expect.stringContaining('Deployment created')
      })

      expect(core.info).toHaveBeenCalledWith(
        'Created deployment comment for PR #42, commit abc123d'
      )
    })

    it('should update existing comment', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([mockExistingComment])

      mockOctokit.rest.issues.updateComment.mockResolvedValue({
        data: { id: 888 }
      })

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Verified, {
        environment: 'preview-123',
        url: 'https://preview-123.example.com'
      })

      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 888,
        body: expect.stringContaining('Deployment ready')
      })

      expect(core.info).toHaveBeenCalledWith(
        'Updated deployment comment for PR #42, commit abc123d'
      )
    })

    it('should minimize previous comments', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate
        .mockResolvedValueOnce([mockOldComment, mockCurrentComment])
        .mockResolvedValueOnce([mockOldComment, mockCurrentComment])

      mockOctokit.graphql.mockResolvedValue({})
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Deployed, {
        environment: 'preview-123'
      })

      expect(mockOctokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining('minimizeComment'),
        expect.objectContaining({
          nodeId: 'node-111'
        })
      )
    })

    it('should handle GraphQL errors when minimizing', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate
        .mockResolvedValueOnce([mockOldComment])
        .mockResolvedValueOnce([mockOldComment])

      mockOctokit.graphql.mockRejectedValue(new Error('GraphQL error'))
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Deployed, {
        environment: 'preview-123'
      })

      expect(core.warning).toHaveBeenCalledWith(
        'Failed to minimize comment node-111: GraphQL error'
      )
    })

    it('should include namespace in comment', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Deployed, {
        environment: 'preview-123',
        namespace: 'my-namespace'
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('my-namespace')
        })
      )
    })

    it('should include application URL in comment', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Verified, {
        environment: 'preview-123',
        url: 'https://preview-123.example.com'
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('https://preview-123.example.com')
        })
      )
    })

    it('should include error message for failed deployments', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Failed, {
        environment: 'preview-123',
        error: 'Deployment timed out'
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Deployment timed out')
        })
      )
    })

    it('should handle API errors gracefully', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockRejectedValue(new Error('API error'))

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateDeploymentComment(DeploymentStatus.Deployed, {
        environment: 'preview-123'
      })

      expect(core.warning).toHaveBeenCalledWith(
        'Failed to post deployment comment: API error'
      )
    })
  })

  describe('createOrUpdateTeardownComment', () => {
    it('should create teardown comment', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateTeardownComment({
        environment: 'preview-123',
        deletedCount: 5
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('torn down')
        })
      )
    })

    it('should skip when no token provided', async () => {
      const manager = new DeploymentCommentManager('', 42, 'abc123')

      await manager.createOrUpdateTeardownComment({
        environment: 'preview-123',
        deletedCount: 3
      })

      expect(core.debug).toHaveBeenCalledWith(
        'Skipping PR comment - no token or no PR context'
      )
    })

    it('should include deleted resource count', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateTeardownComment({
        environment: 'preview-123',
        deletedCount: 7
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('7')
        })
      )
    })

    it('should show manual teardown message for Manual reason', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateTeardownComment({
        environment: 'preview-123',
        teardownReason: TeardownReason.Manual
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('/teardown')
        })
      )
    })

    it('should show PR closed message for PrClosed reason', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateTeardownComment({
        environment: 'preview-123',
        teardownReason: TeardownReason.PrClosed
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('PR was closed')
        })
      )
    })

    it('should show scheduled message and tip for Scheduled reason', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateTeardownComment({
        environment: 'preview-123',
        teardownReason: TeardownReason.Scheduled
      })

      const call = mockOctokit.rest.issues.createComment.mock.calls[0][0]
      expect(call.body).toContain('configured timeout has passed')
      expect(call.body).toContain('keep-preview')
    })

    it('should default to Manual reason when teardownReason is not provided', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.paginate.mockResolvedValue([])
      mockOctokit.rest.issues.createComment.mockResolvedValue({})

      const manager = new DeploymentCommentManager(
        'fake-token',
        42,
        'abc123def'
      )

      await manager.createOrUpdateTeardownComment({
        environment: 'preview-123'
      })

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('/teardown')
        })
      )
    })
  })
})

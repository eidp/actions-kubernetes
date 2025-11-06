import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { DeploymentStatusManager } from '../src/deployment-status-manager.js'

interface MockOctokit {
  rest: {
    repos: {
      createDeploymentStatus: ReturnType<typeof vi.fn>
      listDeployments: ReturnType<typeof vi.fn>
    }
  }
}

describe('DeploymentStatusManager', () => {
  let mockOctokit: MockOctokit

  const mockDeployments = [
    { id: 123, environment: 'pr-30', created_at: '2024-01-01T00:00:00Z' },
    { id: 122, environment: 'pr-30', created_at: '2023-12-31T00:00:00Z' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'debug').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'warning').mockImplementation(() => {})

    Object.defineProperty(github, 'context', {
      value: {
        workflow: 'Test Workflow',
        repo: { owner: 'test-owner', repo: 'test-repo' },
        runId: 12345
      },
      writable: true,
      configurable: true
    })

    mockOctokit = {
      rest: {
        repos: {
          createDeploymentStatus: vi.fn(),
          listDeployments: vi.fn()
        }
      }
    }
  })

  describe('constructor', () => {
    it('should initialize with token and environment', () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      expect(github.getOctokit).toHaveBeenCalledWith('fake-token')
      expect(manager).toBeInstanceOf(DeploymentStatusManager)
    })

    it('should handle missing token', () => {
      const manager = new DeploymentStatusManager('', 'pr-30')

      expect(core.debug).toHaveBeenCalledWith(
        'No GitHub token provided, deployment status manager will no-op'
      )
      expect(manager).toBeInstanceOf(DeploymentStatusManager)
    })

    it('should handle missing environment', () => {
      const manager = new DeploymentStatusManager('fake-token', '')

      expect(core.debug).toHaveBeenCalledWith(
        'No environment provided, deployment status manager will no-op'
      )
      expect(manager).toBeInstanceOf(DeploymentStatusManager)
    })
  })

  describe('updateDeploymentStatus', () => {
    it('should skip when no token provided', async () => {
      const manager = new DeploymentStatusManager('', 'pr-30')

      await manager.updateDeploymentStatus('success', 'https://example.com')

      expect(core.debug).toHaveBeenCalledWith(
        'Skipping deployment status update - no token or environment'
      )
    })

    it('should skip when no environment provided', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      const manager = new DeploymentStatusManager('fake-token', '')

      await manager.updateDeploymentStatus('success', 'https://example.com')

      expect(core.debug).toHaveBeenCalledWith(
        'Skipping deployment status update - no token or environment'
      )
    })

    it('should update deployment status with URL', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.rest.repos.listDeployments.mockResolvedValue({
        data: mockDeployments
      })

      mockOctokit.rest.repos.createDeploymentStatus.mockResolvedValue({
        data: { id: 456 }
      })

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      await manager.updateDeploymentStatus(
        'success',
        'https://example.com',
        'Deployment verified'
      )

      expect(mockOctokit.rest.repos.listDeployments).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        environment: 'pr-30'
      })

      expect(
        mockOctokit.rest.repos.createDeploymentStatus
      ).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        deployment_id: 123,
        state: 'success',
        environment_url: 'https://example.com',
        description: 'Deployment verified',
        auto_inactive: false
      })

      expect(core.info).toHaveBeenCalledWith(
        "Updated deployment 123 status to 'success' with URL: https://example.com"
      )
    })

    it('should update deployment status without URL', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.rest.repos.listDeployments.mockResolvedValue({
        data: mockDeployments
      })

      mockOctokit.rest.repos.createDeploymentStatus.mockResolvedValue({
        data: { id: 456 }
      })

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      await manager.updateDeploymentStatus(
        'failure',
        undefined,
        'Deployment failed'
      )

      expect(
        mockOctokit.rest.repos.createDeploymentStatus
      ).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        deployment_id: 123,
        state: 'failure',
        environment_url: undefined,
        description: 'Deployment failed',
        auto_inactive: false
      })

      expect(core.info).toHaveBeenCalledWith(
        "Updated deployment 123 status to 'failure'"
      )
    })

    it('should use most recent deployment', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.rest.repos.listDeployments.mockResolvedValue({
        data: mockDeployments
      })

      mockOctokit.rest.repos.createDeploymentStatus.mockResolvedValue({
        data: { id: 456 }
      })

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      await manager.updateDeploymentStatus('success', 'https://example.com')

      expect(
        mockOctokit.rest.repos.createDeploymentStatus
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          deployment_id: 123
        })
      )
    })

    it('should warn when no deployment found', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.rest.repos.listDeployments.mockResolvedValue({
        data: []
      })

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      await manager.updateDeploymentStatus('success', 'https://example.com')

      expect(core.warning).toHaveBeenCalledWith(
        "No deployment found for environment 'pr-30' in workflow run 12345"
      )

      expect(
        mockOctokit.rest.repos.createDeploymentStatus
      ).not.toHaveBeenCalled()
    })

    it('should handle API errors when finding deployments', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.rest.repos.listDeployments.mockRejectedValue(
        new Error('API error')
      )

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      await manager.updateDeploymentStatus('success', 'https://example.com')

      expect(core.warning).toHaveBeenCalledWith(
        'Failed to find deployment: API error'
      )
      expect(core.warning).toHaveBeenCalledWith(
        "No deployment found for environment 'pr-30' in workflow run 12345"
      )
    })

    it('should handle API errors when creating status', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.rest.repos.listDeployments.mockResolvedValue({
        data: mockDeployments
      })

      mockOctokit.rest.repos.createDeploymentStatus.mockRejectedValue(
        new Error('Status creation error')
      )

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      await manager.updateDeploymentStatus('success', 'https://example.com')

      expect(core.warning).toHaveBeenCalledWith(
        'Failed to update deployment status: Status creation error'
      )
    })

    it('should support all deployment states', async () => {
      vi.spyOn(github, 'getOctokit').mockReturnValue(
        mockOctokit as unknown as ReturnType<typeof github.getOctokit>
      )

      mockOctokit.rest.repos.listDeployments.mockResolvedValue({
        data: mockDeployments
      })

      mockOctokit.rest.repos.createDeploymentStatus.mockResolvedValue({
        data: { id: 456 }
      })

      const manager = new DeploymentStatusManager('fake-token', 'pr-30')

      const states: Array<
        | 'error'
        | 'failure'
        | 'inactive'
        | 'in_progress'
        | 'queued'
        | 'pending'
        | 'success'
      > = [
        'error',
        'failure',
        'inactive',
        'in_progress',
        'queued',
        'pending',
        'success'
      ]

      for (const state of states) {
        await manager.updateDeploymentStatus(state)

        expect(
          mockOctokit.rest.repos.createDeploymentStatus
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            state
          })
        )
      }
    })
  })
})

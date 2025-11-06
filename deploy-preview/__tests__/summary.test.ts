import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import { generateDeploymentSummary } from '../src/summary.js'
import { DeploymentSummaryData } from '../src/types.js'

describe('generateDeploymentSummary', () => {
  const mockSummary = {
    addHeading: vi.fn().mockReturnThis(),
    addTable: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'startGroup').mockImplementation(() => {})
    vi.spyOn(core, 'endGroup').mockImplementation(() => {})
    Object.defineProperty(core, 'summary', {
      value: mockSummary,
      writable: true,
      configurable: true
    })
  })

  it('should generate summary with all deployment details', async () => {
    const data: DeploymentSummaryData = {
      tenantName: 'test-tenant',
      ciPrefix: 'ci-pr-123-',
      namespace: 'ci-pr-123-test-tenant',
      ociRepoName: 'test-oci-repo',
      kustomizationName: 'test-kustomization',
      gitBranch: 'feature/test'
    }

    await generateDeploymentSummary(data)

    expect(core.startGroup).toHaveBeenCalledWith('Generating GitHub summary')
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      '✅ Preview deployment successful',
      2
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith('Deployment details', 3)
    expect(mockSummary.addTable).toHaveBeenCalledWith([
      [
        { data: 'Field', header: true },
        { data: 'Value', header: true }
      ],
      [{ data: 'Tenant name' }, { data: 'test-tenant' }],
      [{ data: 'CI prefix' }, { data: 'ci-pr-123-' }],
      [{ data: 'Namespace' }, { data: 'ci-pr-123-test-tenant' }],
      [{ data: 'OCIRepository' }, { data: 'test-oci-repo' }],
      [{ data: 'Kustomization' }, { data: 'test-kustomization' }],
      [{ data: 'Git branch' }, { data: 'feature/test' }]
    ])
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('Deployment timestamp:')
    )
    expect(mockSummary.write).toHaveBeenCalled()
    expect(core.endGroup).toHaveBeenCalled()
  })

  it('should format timestamp correctly', async () => {
    const data: DeploymentSummaryData = {
      tenantName: 'test-tenant',
      ciPrefix: 'ci-pr-123-',
      namespace: 'ci-pr-123-test-tenant',
      ociRepoName: 'test-oci-repo',
      kustomizationName: 'test-kustomization',
      gitBranch: 'main'
    }

    await generateDeploymentSummary(data)

    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringMatching(
        /\*Deployment timestamp: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\*/
      )
    )
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import { generateSummary, SummaryInputs } from '../src/summary.js'
import { ResourceVerificationResult } from '../src/types.js'

describe('generateSummary', () => {
  const mockSummary = {
    addHeading: vi.fn().mockReturnThis(),
    addTable: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    addEOL: vi.fn().mockReturnThis(),
    addCodeBlock: vi.fn().mockReturnThis(),
    addQuote: vi.fn().mockReturnThis(),
    addLink: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined)
  }

  const baseInputs: SummaryInputs = {
    kubernetesContext: 'test-context',
    namespace: 'test-namespace',
    fluxResource: 'helmreleases/test-release',
    chartVersion: '1.0.0',
    timeout: '5m'
  }

  const mockVerificationResults: ResourceVerificationResult[] = [
    {
      name: 'test-release',
      type: 'HelmRelease',
      ready: 'True',
      message: 'Release reconciliation succeeded'
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(core, 'summary', {
      value: mockSummary,
      writable: true,
      configurable: true
    })
  })

  it('should generate summary for successful verification', async () => {
    await generateSummary(true, mockVerificationResults, baseInputs)

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      '✅ Deployment verification successful',
      2
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      'Verification details',
      3
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith('Deployment status', 3)
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Kubernetes Context**: `test-context`')
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Namespace**: `test-namespace`')
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Flux Resource**: `helmreleases/test-release`')
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Chart Version**: `1.0.0`')
    )
    expect(mockSummary.addTable).toHaveBeenCalledWith([
      ['Resource', 'Type', 'Status', 'Message'],
      [
        'test-release',
        'HelmRelease',
        '✅ Ready',
        'Release reconciliation succeeded'
      ]
    ])
    expect(mockSummary.write).toHaveBeenCalled()
  })

  it('should generate summary for failed verification', async () => {
    const failedResults: ResourceVerificationResult[] = [
      {
        name: 'test-release',
        type: 'HelmRelease',
        ready: 'False',
        message: 'Reconciliation failed'
      }
    ]

    await generateSummary(
      false,
      failedResults,
      baseInputs,
      'Deployment timed out'
    )

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      '❌ Deployment verification failed',
      2
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith('Error', 3)
    expect(mockSummary.addQuote).toHaveBeenCalledWith('Deployment timed out')
    expect(mockSummary.addTable).toHaveBeenCalledWith([
      ['Resource', 'Type', 'Status', 'Message'],
      ['test-release', 'HelmRelease', '❌ Not Ready', 'Reconciliation failed']
    ])
  })

  it('should include application URL when provided', async () => {
    const inputsWithUrl: SummaryInputs = {
      ...baseInputs,
      url: 'https://preview-123.example.com'
    }

    await generateSummary(true, mockVerificationResults, inputsWithUrl)

    expect(mockSummary.addHeading).toHaveBeenCalledWith('Application URL', 3)
    expect(mockSummary.addRaw).toHaveBeenCalledWith('🔗 ')
    expect(mockSummary.addLink).toHaveBeenCalledWith(
      'https://preview-123.example.com',
      'https://preview-123.example.com'
    )
  })

  it('should show all Flux resources scope when no specific resource provided', async () => {
    const inputsWithoutResource: Partial<SummaryInputs> = {
      kubernetesContext: 'test-context',
      namespace: 'test-namespace',
      timeout: '5m'
    }

    await generateSummary(true, mockVerificationResults, inputsWithoutResource)

    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Scope**: All Flux resources in namespace')
    )
    expect(mockSummary.addRaw).not.toHaveBeenCalledWith(
      expect.stringContaining('**Chart Version**')
    )
  })

  it('should include pod selector when provided', async () => {
    const inputsWithPodSelector: SummaryInputs = {
      ...baseInputs,
      podSelector: 'app=test-app'
    }

    await generateSummary(true, mockVerificationResults, inputsWithPodSelector)

    expect(mockSummary.addHeading).toHaveBeenCalledWith('Pod selector', 3)
    expect(mockSummary.addCodeBlock).toHaveBeenCalledWith('app=test-app')
  })

  it('should handle empty verification results', async () => {
    await generateSummary(true, [], baseInputs)

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      '✅ Deployment verification successful',
      2
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      'Verification details',
      3
    )
    expect(mockSummary.addHeading).not.toHaveBeenCalledWith(
      'Deployment status',
      3
    )
  })

  it('should handle multiple verification results', async () => {
    const multipleResults: ResourceVerificationResult[] = [
      {
        name: 'helm-release-1',
        type: 'HelmRelease',
        ready: 'True',
        message: 'Ready'
      },
      {
        name: 'helm-release-2',
        type: 'HelmRelease',
        ready: 'True',
        message: 'Ready'
      },
      {
        name: 'kustomization-1',
        type: 'Kustomization',
        ready: 'False',
        message: 'Reconciling'
      }
    ]

    await generateSummary(false, multipleResults, baseInputs)

    expect(mockSummary.addTable).toHaveBeenCalledWith([
      ['Resource', 'Type', 'Status', 'Message'],
      ['helm-release-1', 'HelmRelease', '✅ Ready', 'Ready'],
      ['helm-release-2', 'HelmRelease', '✅ Ready', 'Ready'],
      ['kustomization-1', 'Kustomization', '❌ Not Ready', 'Reconciling']
    ])
  })

  it('should handle results with missing message', async () => {
    const resultsWithoutMessage: ResourceVerificationResult[] = [
      {
        name: 'test-release',
        type: 'HelmRelease',
        ready: 'True'
      }
    ]

    await generateSummary(true, resultsWithoutMessage, baseInputs)

    expect(mockSummary.addTable).toHaveBeenCalledWith([
      ['Resource', 'Type', 'Status', 'Message'],
      ['test-release', 'HelmRelease', '✅ Ready', 'N/A']
    ])
  })

  it('should handle partial inputs', async () => {
    const partialInputs: Partial<SummaryInputs> = {
      namespace: 'test-namespace'
    }

    await generateSummary(true, mockVerificationResults, partialInputs)

    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Namespace**: `test-namespace`')
    )
    expect(mockSummary.addRaw).not.toHaveBeenCalledWith(
      expect.stringContaining('**Kubernetes Context**')
    )
  })
})

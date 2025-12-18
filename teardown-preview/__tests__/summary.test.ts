import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import { generateSummary } from '../src/summary.js'
import { ActionInputs, ActionOutputs } from '../src/types.js'

describe('generateSummary', () => {
  const mockSummary = {
    addHeading: vi.fn().mockReturnThis(),
    addTable: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    addEOL: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined)
  }

  const baseInputs: ActionInputs = {
    kubernetesContext: 'test-context',
    reference: 'pr-123',
    maxAge: undefined,
    dryRun: false,
    waitForDeletion: false,
    timeout: '5m',
    githubToken: 'test-token'
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

  it('should generate summary for successful teardown with deleted resources', async () => {
    const inputs: ActionInputs = { ...baseInputs }
    const outputs: ActionOutputs = {
      deletedCount: 2,
      skippedCount: 0,
      deletedResources: [
        {
          name: 'test-kust',
          type: 'Kustomization',
          age: '1h 30m',
          reference: 'pr-123'
        },
        {
          name: 'test-oci',
          type: 'OCIRepository',
          age: '1h 30m',
          reference: 'pr-123'
        }
      ],
      skippedResources: []
    }

    await generateSummary(inputs, outputs)

    expect(core.startGroup).toHaveBeenCalledWith('Generating GitHub summary')
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      '✅ Preview teardown successful',
      2
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith('Teardown summary', 3)
    expect(mockSummary.addHeading).toHaveBeenCalledWith('Deleted resources', 3)
    expect(mockSummary.addTable).toHaveBeenCalledWith([
      [
        { data: 'Metric', header: true },
        { data: 'Count', header: true }
      ],
      [{ data: '**Deleted**' }, { data: '2' }],
      [{ data: '**Skipped**' }, { data: '0' }]
    ])
    expect(mockSummary.write).toHaveBeenCalled()
    expect(core.endGroup).toHaveBeenCalled()
  })

  it('should generate summary for dry run', async () => {
    const inputs: ActionInputs = { ...baseInputs, dryRun: true }
    const outputs: ActionOutputs = {
      deletedCount: 2,
      skippedCount: 0,
      deletedResources: [
        {
          name: 'test-kust',
          type: 'Kustomization',
          age: '1h 30m',
          reference: 'pr-123'
        }
      ],
      skippedResources: []
    }

    await generateSummary(inputs, outputs)

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      'ℹ️ Dry run: Preview teardown report',
      2
    )
    expect(mockSummary.addHeading).toHaveBeenCalledWith('Would delete', 3)
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([{ data: '**Would delete**' }, { data: '2' }])
      ])
    )
  })

  it('should generate summary when no previews to clean up', async () => {
    const inputs: ActionInputs = { ...baseInputs }
    const outputs: ActionOutputs = {
      deletedCount: 0,
      skippedCount: 0,
      deletedResources: [],
      skippedResources: []
    }

    await generateSummary(inputs, outputs)

    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      'ℹ️ No previews to clean up',
      2
    )
  })

  it('should show skipped resources when present', async () => {
    const inputs: ActionInputs = { ...baseInputs }
    const outputs: ActionOutputs = {
      deletedCount: 1,
      skippedCount: 1,
      deletedResources: [
        {
          name: 'test-kust',
          type: 'Kustomization',
          age: '1h 30m',
          reference: 'pr-123'
        }
      ],
      skippedResources: [
        {
          name: 'protected-kust',
          reason: 'Protected by keep-preview label',
          age: '2d 3h'
        }
      ]
    }

    await generateSummary(inputs, outputs)

    expect(mockSummary.addHeading).toHaveBeenCalledWith('Skipped resources', 3)
    expect(mockSummary.addTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        [
          { data: 'Resource', header: true },
          { data: 'Reason', header: true },
          { data: 'Age', header: true }
        ]
      ])
    )
  })

  it('should include bulk cleanup details when no reference specified', async () => {
    const inputs: ActionInputs = {
      ...baseInputs,
      reference: undefined,
      maxAge: '7d'
    }
    const outputs: ActionOutputs = {
      deletedCount: 3,
      skippedCount: 0,
      deletedResources: [],
      skippedResources: []
    }

    await generateSummary(inputs, outputs)

    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Scope**: Bulk cleanup')
    )
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Max Age**: `7d`')
    )
  })

  it('should include wait for deletion details when enabled', async () => {
    const inputs: ActionInputs = {
      ...baseInputs,
      waitForDeletion: true,
      timeout: '10m'
    }
    const outputs: ActionOutputs = {
      deletedCount: 1,
      skippedCount: 0,
      deletedResources: [],
      skippedResources: []
    }

    await generateSummary(inputs, outputs)

    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('**Wait for Deletion**: `10m`')
    )
  })

  it('should format timestamp correctly', async () => {
    const inputs: ActionInputs = { ...baseInputs }
    const outputs: ActionOutputs = {
      deletedCount: 0,
      skippedCount: 0,
      deletedResources: [],
      skippedResources: []
    }

    await generateSummary(inputs, outputs)

    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      expect.stringMatching(
        /\*Teardown timestamp: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\*/
      )
    )
  })
})

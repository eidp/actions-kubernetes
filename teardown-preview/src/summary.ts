import * as core from '@actions/core'
import { ActionInputs, ActionOutputs } from './types'

export async function generateSummary(
  inputs: ActionInputs,
  outputs: ActionOutputs
): Promise<void> {
  core.startGroup('Generating GitHub summary')

  const summary = core.summary

  if (inputs.dryRun) {
    summary.addHeading('ℹ️ Dry Run: Preview Teardown Report', 2)
  } else if (outputs.deletedCount > 0) {
    summary.addHeading('✅ Preview Teardown Successful', 2)
  } else {
    summary.addHeading('ℹ️ No Previews to Clean Up', 2)
  }

  summary.addHeading('Teardown Summary', 3)
  summary.addTable([
    [
      { data: 'Metric', header: true },
      { data: 'Count', header: true }
    ],
    [
      { data: inputs.dryRun ? '**Would delete**' : '**Deleted**' },
      { data: outputs.deletedCount.toString() }
    ],
    [{ data: '**Skipped**' }, { data: outputs.skippedCount.toString() }]
  ])

  if (outputs.deletedCount > 0) {
    summary.addHeading(inputs.dryRun ? 'Would Delete' : 'Deleted Resources', 3)
    summary.addTable([
      [
        { data: 'Resource', header: true },
        { data: 'Type', header: true },
        { data: 'Age', header: true },
        { data: 'CI Prefix', header: true }
      ],
      ...outputs.deletedResources.map((r) => [
        { data: r.name },
        { data: r.type },
        { data: r.age || 'N/A' },
        { data: r.ciPrefix || 'N/A' }
      ])
    ])
  }

  if (outputs.skippedCount > 0) {
    summary.addHeading('Skipped Resources', 3)
    summary.addTable([
      [
        { data: 'Resource', header: true },
        { data: 'Reason', header: true },
        { data: 'Age', header: true }
      ],
      ...outputs.skippedResources.map((r) => [
        { data: r.name },
        { data: r.reason },
        { data: r.age || 'N/A' }
      ])
    ])
  }

  summary.addHeading('Teardown Details', 3)
  const detailsTable: Array<[{ data: string }, { data: string }]> = [
    [
      { data: '**Kubernetes Context**' },
      { data: `\`${inputs.kubernetesContext}\`` }
    ]
  ]

  if (inputs.reference) {
    detailsTable.push([
      { data: '**Target Reference**' },
      { data: `\`${inputs.reference}\`` }
    ])
  } else {
    detailsTable.push([{ data: '**Scope**' }, { data: 'Bulk cleanup' }])
    if (inputs.maxAge) {
      detailsTable.push([
        { data: '**Max Age**' },
        { data: `\`${inputs.maxAge}\`` }
      ])
    }
  }

  if (inputs.waitForDeletion) {
    detailsTable.push([
      { data: '**Wait for Deletion**' },
      { data: `\`${inputs.timeout}\`` }
    ])
  }

  summary.addTable(detailsTable)

  summary.addRaw('---')
  summary.addRaw(
    `*Teardown timestamp: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC*`
  )

  await summary.write()

  core.endGroup()
}

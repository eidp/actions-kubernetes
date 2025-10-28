import * as core from '@actions/core'
import { ActionInputs, ActionOutputs } from './types'

export async function generateSummary(
  inputs: ActionInputs,
  outputs: ActionOutputs
): Promise<void> {
  core.startGroup('Generating GitHub summary')

  const summary = core.summary

  if (inputs.dryRun) {
    summary.addHeading('ℹ️ Dry run: Preview teardown report', 2)
  } else if (outputs.deletedCount > 0) {
    summary.addHeading('✅ Preview teardown successful', 2)
  } else {
    summary.addHeading('ℹ️ No previews to clean up', 2)
  }

  summary.addHeading('Teardown summary', 3)
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
    summary.addHeading(inputs.dryRun ? 'Would delete' : 'Deleted resources', 3)
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
    summary.addHeading('Skipped resources', 3)
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

  summary.addHeading('Teardown details', 3)
  summary.addEOL()
  const detailsList: string[][] = []

  detailsList.push([
    '**Kubernetes Context**',
    `\`${inputs.kubernetesContext}\``
  ])

  if (inputs.reference) {
    detailsList.push(['**Target Reference**', `\`${inputs.reference}\``])
  } else {
    detailsList.push(['**Scope**', 'Bulk cleanup'])
    if (inputs.maxAge) {
      detailsList.push(['**Max Age**', `\`${inputs.maxAge}\``])
    }
  }

  if (inputs.waitForDeletion) {
    detailsList.push(['**Wait for Deletion**', `\`${inputs.timeout}\``])
  }

  detailsList.forEach((item) => {
    summary.addRaw(`- ${item[0]}: ${item[1]}\n`)
  })

  summary.addRaw(
    `\n---\n*Teardown timestamp: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC*`
  )

  await summary.write()

  core.endGroup()
}

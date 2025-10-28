import * as core from '@actions/core'
import { DeploymentStatus } from './types'

export interface SummaryInputs {
  kubernetesContext: string
  namespace: string
  fluxResource?: string
  chartVersion?: string
  timeout: string
  podSelector?: string
}

export async function generateSummary(
  success: boolean,
  deploymentStatuses: DeploymentStatus[],
  inputs: Partial<SummaryInputs>,
  errorMessage?: string
): Promise<void> {
  const summary = core.summary

  // Add header
  if (success) {
    summary.addHeading('✅ Deployment verification successful', 2)
  } else {
    summary.addHeading('❌ Deployment verification failed', 2)
  }

  summary.addEOL()

  // Add verification details
  summary.addHeading('Verification details', 3)
  summary.addEOL()
  const detailsList: string[][] = []

  if (inputs.kubernetesContext) {
    detailsList.push([
      '**Kubernetes Context**',
      `\`${inputs.kubernetesContext}\``
    ])
  }

  if (inputs.namespace) {
    detailsList.push(['**Namespace**', `\`${inputs.namespace}\``])
  }

  if (inputs.fluxResource) {
    detailsList.push(['**Flux Resource**', `\`${inputs.fluxResource}\``])
    if (inputs.chartVersion) {
      detailsList.push(['**Chart Version**', `\`${inputs.chartVersion}\``])
    }
  } else {
    detailsList.push(['**Scope**', 'All Flux resources in namespace'])
  }

  if (inputs.timeout) {
    detailsList.push(['**Timeout**', `\`${inputs.timeout}\``])
  }

  detailsList.forEach((item) => {
    summary.addRaw(`- ${item[0]}: ${item[1]}\n`)
  })

  // Add deployment status table if we have statuses
  if (deploymentStatuses.length > 0) {
    summary.addEOL()
    summary.addHeading('Deployment status', 3)
    summary.addEOL()

    const statusTable: string[][] = [['Resource', 'Type', 'Status', 'Message']]

    deploymentStatuses.forEach((status) => {
      statusTable.push([
        status.name,
        status.type,
        status.ready === 'True' ? '✅ Ready' : '❌ Not Ready',
        status.message || 'N/A'
      ])
    })

    summary.addTable(statusTable)
  }

  // Add pod selector if provided
  if (inputs.podSelector) {
    summary.addEOL()
    summary.addHeading('Pod selector', 3)
    summary.addCodeBlock(inputs.podSelector)
  }

  // Add error message if failed
  if (!success && errorMessage) {
    summary.addEOL()
    summary.addHeading('Error', 3)
    summary.addQuote(errorMessage)
  }

  await summary.write()
}

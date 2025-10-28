import * as core from '@actions/core'
import { verifyKubernetesConnectivity } from '../../shared/src/k8s-connectivity'
import { verifySpecificResource, verifyAllResources } from './k8s-verification'
import { generateSummary } from './summary'
import { DeploymentStatus } from './types'
import { parseDuration } from './utils'

async function run(): Promise<void> {
  let deploymentStatuses: DeploymentStatus[] = []
  let kubernetesContext = ''
  let namespace = ''
  let fluxResource = ''
  let chartVersion = ''
  let timeout = ''
  let podSelector = ''

  try {
    // Read inputs
    kubernetesContext = core.getInput('kubernetes-context', { required: true })
    namespace = core.getInput('namespace', { required: true })
    fluxResource = core.getInput('flux-resource')
    chartVersion = core.getInput('chart-version')
    timeout = core.getInput('timeout') || '3m'
    podSelector = core.getInput('pod-selector')
    const initialWaitInput = core.getInput('initial-wait') || '0'

    // Initial wait
    const initialWait = parseDuration(initialWaitInput)

    if (initialWait > 0) {
      core.info(
        `Waiting ${initialWaitInput} for Kubernetes resources to reconcile...`
      )
      await new Promise((resolve) => setTimeout(resolve, initialWait))
    } else {
      core.info('Skipping initial wait (initial-wait=0)')
    }

    // Verify connectivity with namespace and permission checks
    const kc = await verifyKubernetesConnectivity(kubernetesContext, {
      checkNamespace: namespace,
      checkPermissions: true
    })

    // Verify deployment (specific or all)
    if (fluxResource) {
      deploymentStatuses = await verifySpecificResource(
        kc,
        namespace,
        fluxResource,
        chartVersion || undefined,
        timeout
      )
    } else {
      deploymentStatuses = await verifyAllResources(
        kc,
        namespace,
        chartVersion || undefined,
        timeout
      )
    }

    // Generate summary
    await generateSummary(true, deploymentStatuses, {
      kubernetesContext,
      namespace,
      fluxResource: fluxResource || undefined,
      chartVersion: chartVersion || undefined,
      timeout,
      podSelector: podSelector || undefined
    })

    core.info('✅ Deployment verification successful')
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred'

    // Generate failure summary
    await generateSummary(
      false,
      deploymentStatuses,
      {
        kubernetesContext,
        namespace,
        fluxResource: fluxResource || undefined,
        chartVersion: chartVersion || undefined,
        timeout,
        podSelector: podSelector || undefined
      },
      errorMessage
    )

    core.setFailed(errorMessage)
  }
}

run()

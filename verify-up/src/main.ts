import * as core from '@actions/core'
import { verifyKubernetesConnectivity } from '@actions-kubernetes/shared/k8s-connectivity'
import { verifySpecificResource, discoverURL } from './k8s-verification'
import { generateSummary } from './summary'
import { DeploymentStatus } from './types'
import {
  DeploymentCommentManager,
  DeploymentStatus as CommentStatus
} from '@actions-kubernetes/shared/deployment-comment-manager'

async function run(): Promise<void> {
  let deploymentStatuses: DeploymentStatus[] = []
  let kubernetesContext = ''
  let namespace = ''
  let fluxResource = ''
  let chartVersion = ''
  let timeout = ''
  let podSelector = ''
  let url = ''
  let githubToken = ''
  let environment = ''

  try {
    // Read inputs
    environment = core.getInput('environment', { required: true })
    kubernetesContext = core.getInput('kubernetes-context', { required: true })
    namespace = core.getInput('namespace', { required: true })
    fluxResource = core.getInput('flux-resource', { required: true })
    chartVersion = core.getInput('chart-version')
    timeout = core.getInput('timeout') || '3m'
    podSelector = core.getInput('pod-selector')
    const ingressSelector = core.getInput('ingress-selector')
    githubToken =
      core.getInput('github-token') || process.env.GITHUB_TOKEN || ''

    // Verify connectivity with namespace and permission checks
    const kc = await verifyKubernetesConnectivity(kubernetesContext, {
      checkNamespace: namespace,
      checkPermissions: true
    })

    // Verify deployment
    deploymentStatuses = await verifySpecificResource(
      kc,
      namespace,
      fluxResource,
      chartVersion || undefined,
      timeout
    )

    // Discover application URL
    url = await discoverURL(kc, namespace, ingressSelector)
    core.setOutput('url', url)

    // Generate summary
    await generateSummary(true, deploymentStatuses, {
      kubernetesContext,
      namespace,
      fluxResource: fluxResource || undefined,
      chartVersion: chartVersion || undefined,
      timeout,
      podSelector: podSelector || undefined,
      url: url || undefined
    })

    // Post PR comment if in PR context and token provided
    const commentManager = new DeploymentCommentManager(githubToken)
    await commentManager.createOrUpdateDeploymentComment(
      CommentStatus.Verified,
      {
        namespace,
        url: url || undefined,
        environment,
        verifiedResources: deploymentStatuses.map((ds) => ({
          name: ds.name,
          type: ds.type,
          ready: ds.ready,
          message: ds.message
        }))
      }
    )

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
        podSelector: podSelector || undefined,
        url: url || undefined
      },
      errorMessage
    )

    // Post failure PR comment
    const failureCommentManager = new DeploymentCommentManager(githubToken)
    await failureCommentManager.createOrUpdateDeploymentComment(
      CommentStatus.Failed,
      {
        namespace,
        url: url || undefined,
        error: errorMessage,
        environment,
        verifiedResources:
          deploymentStatuses.length > 0
            ? deploymentStatuses.map((ds) => ({
                name: ds.name,
                type: ds.type,
                ready: ds.ready,
                message: ds.message
              }))
            : undefined
      }
    )

    core.setFailed(errorMessage)
  }
}

run()

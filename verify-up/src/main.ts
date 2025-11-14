import * as core from '@actions/core'
import { verifyKubernetesAccess } from '@actions-kubernetes/k8s-client'
import { verifySpecificResource, discoverURL } from './k8s-verification'
import { generateSummary } from './summary'
import { ResourceVerificationResult } from './types'
import {
  DeploymentCommentManager,
  DeploymentStatus
} from '@actions-kubernetes/shared/deployment-comment-manager'
import { DeploymentStatusManager } from '@actions-kubernetes/shared/deployment-status-manager'
import { getPRDetails, getPRNumber } from '@actions-kubernetes/shared/pr-utils'
import * as github from '@actions/github'

async function run(): Promise<void> {
  let verificationResults: ResourceVerificationResult[] = []
  let kubernetesContext = ''
  let namespace = ''
  let fluxResource = ''
  let chartVersion = ''
  let timeout = ''
  let podSelector = ''
  let url = ''
  let githubToken = ''
  let environment = ''
  const prNumber = getPRNumber()
  let commitSha: string = github.context.sha

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

    if (prNumber) {
      const prDetails = await getPRDetails(githubToken, prNumber)
      commitSha = prDetails.sha
      core.info(`Resolved PR HEAD SHA: ${commitSha.substring(0, 7)}`)
    }

    // Verify connectivity with namespace and permission checks
    const kc = await verifyKubernetesAccess(kubernetesContext)

    // Verify deployment
    verificationResults = await verifySpecificResource(
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
    await generateSummary(true, verificationResults, {
      kubernetesContext,
      namespace,
      fluxResource: fluxResource || undefined,
      chartVersion: chartVersion || undefined,
      timeout,
      podSelector: podSelector || undefined,
      url: url || undefined
    })

    // Post PR comment if in PR context and token provided
    const commentManager = new DeploymentCommentManager(
      githubToken,
      prNumber,
      commitSha
    )
    await commentManager.createOrUpdateDeploymentComment(
      DeploymentStatus.Verified,
      {
        namespace,
        url: url || undefined,
        environment,
        verifiedResources: verificationResults.map((result) => ({
          name: result.name,
          type: result.type,
          ready: result.ready,
          message: result.message
        }))
      }
    )

    // Update deployment status with URL
    const deploymentStatusManager = new DeploymentStatusManager(
      githubToken,
      environment
    )
    await deploymentStatusManager.updateDeploymentStatus(
      'success',
      url || undefined,
      'Deployment verified and ready'
    )

    core.info('✅ Deployment verification successful')
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred'

    // Generate failure summary
    await generateSummary(
      false,
      verificationResults,
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
    const failureCommentManager = new DeploymentCommentManager(
      githubToken,
      prNumber,
      commitSha || github.context.sha
    )
    await failureCommentManager.createOrUpdateDeploymentComment(
      DeploymentStatus.Failed,
      {
        namespace,
        url: url || undefined,
        error: errorMessage,
        environment,
        verifiedResources:
          verificationResults.length > 0
            ? verificationResults.map((result) => ({
                ...result
              }))
            : undefined
      }
    )

    // Update deployment status to failure
    const shortenedErrorMessage =
      errorMessage.substring(0, 137) + (errorMessage.length == 137 ? '...' : '')

    const failureDeploymentStatusManager = new DeploymentStatusManager(
      githubToken,
      environment
    )
    await failureDeploymentStatusManager.updateDeploymentStatus(
      'failure',
      undefined,
      shortenedErrorMessage
    )

    core.setFailed(errorMessage)
  }
}

run()

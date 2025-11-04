import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  sanitizeName,
  truncateName
} from '@actions-kubernetes/shared/string-utils'
import {
  createOCIRepository,
  createKustomization,
  readTenantsReplacementConfig
} from './k8s-operations'
import { generateDeploymentSummary } from './summary'
import {
  detectSlashCommand,
  checkPermissions,
  rejectUnauthorised,
  addReaction
} from '@actions-kubernetes/shared/slash-commands'
import { verifyKubernetesAccess } from '@actions-kubernetes/k8s-client'
import {
  DeploymentCommentManager,
  DeploymentStatus
} from '@actions-kubernetes/shared/deployment-comment-manager'
import { DeploymentStatusManager } from '@actions-kubernetes/shared/deployment-status-manager'
import { getPRDetails, getPRNumber } from '@actions-kubernetes/shared/pr-utils'
import { ActionInputs, ResourceNames, SlashCommandResult } from './types'

function getActionInputs(): ActionInputs {
  const githubToken =
    core.getInput('github-token') || process.env.GITHUB_TOKEN || ''
  const environment = core.getInput('environment', { required: true })
  const kubernetesContext = core.getInput('kubernetes-context', {
    required: true
  })
  const tenantName = core.getInput('tenant-name', { required: true })
  const reference = core.getInput('reference', { required: true })
  const ciPrefixLengthStr = core.getInput('ci-prefix-length') || '16'
  const chartVersion = core.getInput('chart-version')
  const timeout = core.getInput('timeout') || '5m'

  const ciPrefixLength = parseInt(ciPrefixLengthStr, 10)

  if (ciPrefixLength > 24) {
    throw new Error(
      `The 'ci-prefix-length' input cannot be greater than 24, but got: ${ciPrefixLength}`
    )
  }

  return {
    githubToken,
    environment,
    kubernetesContext,
    tenantName,
    reference,
    ciPrefixLength,
    chartVersion,
    timeout
  }
}

async function handleSlashCommand(
  githubToken: string
): Promise<SlashCommandResult> {
  const slashContext = await detectSlashCommand('deploy')

  if (!slashContext.shouldExecute) {
    core.info('Skipping execution (no matching command or not applicable)')
    return { shouldExecute: false, commentId: null }
  }

  if (!slashContext.isSlashCommand) {
    return { shouldExecute: true, commentId: null }
  }

  core.info('Processing /deploy slash command')

  // Add "eyes" reaction immediately
  if (slashContext.commentId) {
    await addReaction(githubToken, slashContext.commentId, 'eyes')
  }

  // Check permissions
  if (slashContext.commenter) {
    const hasPermission = await checkPermissions(
      githubToken,
      slashContext.commenter
    )

    if (!hasPermission) {
      await rejectUnauthorised(
        githubToken,
        slashContext.prNumber!,
        slashContext.commentId!,
        slashContext.commenter
      )
      return { shouldExecute: false, commentId: null }
    }
  }

  core.info(`Executing deploy for PR #${slashContext.prNumber}`)
  return { shouldExecute: true, commentId: slashContext.commentId ?? null }
}

function generateResourceNames(
  tenantName: string,
  reference: string,
  ciPrefixLength: number
): ResourceNames {
  core.startGroup('Generating resource names')

  core.info(`Using reference: ${reference}`)

  const truncatedRef = reference.substring(0, ciPrefixLength)
  const ciPrefix = sanitizeName(`ci-${truncatedRef}-`)
  core.info(`Generated CI prefix: ${ciPrefix}`)

  const ociRepoName = truncateName(`${ciPrefix}${tenantName}-oci`)
  const kustomizationName = truncateName(`${ciPrefix}${tenantName}-tenant`)
  const namespace = truncateName(`${ciPrefix}${tenantName}`)

  core.info(`OCIRepository name: ${ociRepoName}`)
  core.info(`Kustomization name: ${kustomizationName}`)
  core.info(`Namespace: ${namespace}`)

  core.setOutput('ci-prefix', ciPrefix)
  core.setOutput('oci-repository-name', ociRepoName)
  core.setOutput('kustomization-name', kustomizationName)
  core.setOutput('namespace', namespace)

  core.endGroup()

  return { ciPrefix, ociRepoName, kustomizationName, namespace }
}

async function run(): Promise<void> {
  const prNumber = getPRNumber()
  let commitSha: string = github.context.sha
  let gitBranch = ''
  let inputs: ActionInputs | null = null
  let resourceNames: ResourceNames | null = null

  try {
    inputs = getActionInputs()

    // Get PR details early to have commit SHA and branch
    if (prNumber) {
      const prDetails = await getPRDetails(inputs.githubToken, prNumber)
      commitSha = prDetails.sha
      gitBranch = prDetails.branch
      core.info(
        `Resolved PR details - SHA: ${commitSha.substring(0, 7)}, Branch: ${gitBranch}`
      )
    }

    // If gitBranch wasn't set from PR API (non-PR context), use environment variables
    if (!gitBranch) {
      gitBranch =
        process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || ''
    }

    const slashCommandResult = await handleSlashCommand(inputs.githubToken)
    if (!slashCommandResult.shouldExecute) {
      return
    }

    const slashCommandId = slashCommandResult.commentId

    // Verify Kubernetes connectivity
    const kc = await verifyKubernetesAccess(inputs.kubernetesContext)

    // Read tenant replacement config from ConfigMap
    const { instanceName, clusterName, objectStoreEndpoint } =
      await readTenantsReplacementConfig(kc)

    resourceNames = generateResourceNames(
      inputs.tenantName,
      inputs.reference,
      inputs.ciPrefixLength
    )

    core.startGroup('Creating FluxCD resources')

    await createOCIRepository(kc, {
      name: resourceNames.ociRepoName,
      prNumber,
      ...inputs,
      ...resourceNames
    })

    await createKustomization(kc, {
      name: resourceNames.kustomizationName,
      gitBranch,
      instanceName,
      clusterName,
      objectStoreEndpoint,
      ...inputs,
      ...resourceNames
    })

    core.endGroup()

    await generateDeploymentSummary({
      gitBranch,
      ...inputs,
      ...resourceNames
    })

    core.info('✅ Preview deployment resources created successfully')

    // Post success comment to PR
    const commentManager = new DeploymentCommentManager(
      inputs.githubToken,
      prNumber,
      commitSha
    )
    await commentManager.createOrUpdateDeploymentComment(
      DeploymentStatus.Deployed,
      {
        namespace: resourceNames.namespace,
        tenant: inputs.tenantName,
        environment: inputs.environment
      }
    )

    // Add success reaction for slash commands
    if (slashCommandId) {
      await addReaction(inputs.githubToken, slashCommandId, '+1')
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred'

    // Post failure comment to PR
    if (inputs && prNumber) {
      const commentManager = new DeploymentCommentManager(
        inputs.githubToken,
        prNumber,
        commitSha
      )
      await commentManager.createOrUpdateDeploymentComment(
        DeploymentStatus.Failed,
        {
          namespace: resourceNames?.namespace ?? '',
          tenant: inputs.tenantName,
          error: errorMessage,
          environment: inputs.environment
        }
      )

      // Update deployment status to error
      const deploymentStatusManager = new DeploymentStatusManager(
        inputs.githubToken,
        inputs.environment
      )
      await deploymentStatusManager.updateDeploymentStatus(
        'error',
        undefined,
        errorMessage
      )
    }

    core.setFailed(errorMessage)
  }
}

run()

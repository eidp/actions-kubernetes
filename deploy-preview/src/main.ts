import * as core from '@actions/core'
import * as github from '@actions/github'
import { sanitizeName, truncateName } from './utils'
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
import { verifyKubernetesConnectivity } from '@actions-kubernetes/shared/k8s-connectivity'
import {
  DeploymentCommentManager,
  DeploymentStatus
} from '@actions-kubernetes/shared/deployment-comment-manager'
import { getPRHeadSha, getPRNumber } from '@actions-kubernetes/shared/pr-utils'

async function run(): Promise<void> {
  let tenantName = ''
  let namespace = ''
  let ciPrefix = ''
  let gitBranch = ''
  const environment = ''
  const githubToken =
    core.getInput('github-token') || process.env.GITHUB_TOKEN || ''
  let slashCommandId: number | null = null
  const prNumber = getPRNumber()
  let commitSha: string | undefined

  if (prNumber) {
    commitSha = await getPRHeadSha(githubToken, prNumber)
    core.info(`Resolved PR HEAD SHA: ${commitSha.substring(0, 7)}`)
  } else {
    commitSha = github.context.sha
  }

  try {
    // Detect slash command
    const slashContext = await detectSlashCommand('deploy')

    if (!slashContext.shouldExecute) {
      core.info('Skipping execution (no matching command or not applicable)')
      return
    }

    // Handle slash command permissions and reactions
    if (slashContext.isSlashCommand) {
      core.info('Processing /deploy slash command')
      slashCommandId = slashContext.commentId

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
          return
        }
      }

      core.info(`Executing deploy for PR #${slashContext.prNumber}`)
    }

    const environment = core.getInput('environment', { required: true })
    const kubernetesContext = core.getInput('kubernetes-context', {
      required: true
    })
    tenantName = core.getInput('tenant-name', { required: true })
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

    // Verify Kubernetes connectivity
    const kc = await verifyKubernetesConnectivity(kubernetesContext)

    // Read tenant replacement config from ConfigMap
    const { instanceName, clusterName, objectStoreEndpoint } =
      await readTenantsReplacementConfig(kc)

    core.startGroup('Generating resource names')

    core.info(`Using reference: ${reference}`)

    const truncatedRef = reference.substring(0, ciPrefixLength)
    ciPrefix = sanitizeName(`ci-${truncatedRef}-`)
    core.info(`Generated CI prefix: ${ciPrefix}`)

    const ociRepoName = truncateName(`${ciPrefix}${tenantName}-oci`)
    const kustomizationName = truncateName(`${ciPrefix}${tenantName}-tenant`)
    namespace = truncateName(`${ciPrefix}${tenantName}`)

    core.info(`OCIRepository name: ${ociRepoName}`)
    core.info(`Kustomization name: ${kustomizationName}`)
    core.info(`Namespace: ${namespace}`)

    core.setOutput('ci-prefix', ciPrefix)
    core.setOutput('oci-repository-name', ociRepoName)
    core.setOutput('kustomization-name', kustomizationName)
    core.setOutput('namespace', namespace)

    core.endGroup()

    core.startGroup('Creating FluxCD resources')

    await createOCIRepository(kc, {
      name: ociRepoName,
      tenantName,
      reference,
      environment
    })

    gitBranch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || ''

    await createKustomization(kc, {
      name: kustomizationName,
      ociRepoName,
      tenantName,
      reference,
      ciPrefix,
      namespace,
      environment,
      gitBranch,
      chartVersion,
      timeout,
      instanceName,
      clusterName,
      objectStoreEndpoint
    })

    core.endGroup()

    await generateDeploymentSummary({
      tenantName,
      ciPrefix,
      namespace,
      ociRepoName,
      kustomizationName,
      gitBranch
    })

    core.info('✅ Preview deployment resources created successfully')

    // Post success comment to PR
    const commentManager = new DeploymentCommentManager(
      githubToken,
      prNumber,
      commitSha
    )
    await commentManager.createOrUpdateDeploymentComment(
      DeploymentStatus.Deployed,
      {
        namespace,
        tenant: tenantName,
        environment
      }
    )

    // Add success reaction for slash commands
    if (slashCommandId) {
      await addReaction(githubToken, slashCommandId, '+1')
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred'

    // Post failure comment to PR
    const commentManager = new DeploymentCommentManager(
      githubToken,
      prNumber,
      commitSha
    )
    await commentManager.createOrUpdateDeploymentComment(
      DeploymentStatus.Failed,
      {
        namespace,
        tenant: tenantName,
        error: errorMessage,
        environment
      }
    )

    // Add failure reaction for slash commands
    if (slashCommandId) {
      await addReaction(githubToken, slashCommandId, '-1')
    }

    core.setFailed(errorMessage)
  }
}

run()

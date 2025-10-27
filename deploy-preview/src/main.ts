import * as core from '@actions/core'
import { postDeploymentComment } from './pr-comments'
import { sanitizeName, truncateName } from './utils'
import {
  verifyKubernetesConnectivity,
  createOCIRepository,
  createKustomization,
  discoverPreviewURL
} from './k8s-operations'
import { generateDeploymentSummary } from './summary'

async function run(): Promise<void> {
  let tenantName = ''
  let namespace = ''
  let ciPrefix = ''
  let gitBranch = ''
  let previewUrl = ''
  const githubToken = core.getInput('github-token')

  try {
    const environment = core.getInput('environment', { required: true })
    const kubernetesContext = core.getInput('kubernetes-context', {
      required: true
    })
    tenantName = core.getInput('tenant-name', { required: true })
    const reference = core.getInput('reference', { required: true })
    const ciPrefixLengthStr = core.getInput('ci-prefix-length') || '16'
    const chartVersion = core.getInput('chart-version')
    const timeout = core.getInput('timeout') || '5m'
    const ingressSelector = core.getInput('ingress-selector')

    const ciPrefixLength = parseInt(ciPrefixLengthStr, 10)

    if (ciPrefixLength > 24) {
      throw new Error(
        `The 'ci-prefix-length' input cannot be greater than 24, but got: ${ciPrefixLength}`
      )
    }

    // Verify Kubernetes connectivity
    const kc = await verifyKubernetesConnectivity(kubernetesContext)

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
      reference
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
      timeout
    })

    core.endGroup()

    previewUrl = await discoverPreviewURL(kc, namespace, ingressSelector)
    core.setOutput('preview-url', previewUrl)

    await generateDeploymentSummary({
      tenantName,
      ciPrefix,
      namespace,
      ociRepoName,
      kustomizationName,
      gitBranch,
      previewUrl
    })

    core.info('✅ Preview deployment resources created successfully')

    // Post success comment to PR
    await postDeploymentComment(githubToken, true, {
      tenantName,
      namespace,
      ciPrefix,
      previewUrl,
      gitBranch
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred'

    // Post failure comment to PR
    await postDeploymentComment(githubToken, false, {
      tenantName,
      namespace,
      ciPrefix,
      previewUrl,
      gitBranch,
      errorMessage
    })

    core.setFailed(errorMessage)
  }
}

run()

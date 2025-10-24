import * as core from '@actions/core'
import * as github from '@actions/github'
import * as k8s from '@kubernetes/client-node'
import { Kustomization, OCIRepository } from './types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

function sanitizeLabelValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .substring(0, 63)
    .replace(/[^a-z0-9]+$/, '')
}

function truncateName(name: string, maxLength: number = 63): string {
  if (name.length > maxLength) {
    core.warning(`Name truncated to ${maxLength} characters: ${name}`)
    return name.substring(0, maxLength)
  }
  return name
}

async function run(): Promise<void> {
  try {
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

    // Verify Kubernetes connectivity
    core.startGroup('Verifying Kubernetes connectivity')

    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()

    const contexts = kc.getContexts()
    const contextExists = contexts.some((ctx) => ctx.name === kubernetesContext)

    if (!contextExists) {
      core.error(
        `Cannot find context '${kubernetesContext}' in kubeconfig. Available contexts:`
      )
      contexts.forEach((ctx) => core.info(`  - ${ctx.name}`))
      throw new Error(`Context '${kubernetesContext}' does not exist`)
    }

    kc.setCurrentContext(kubernetesContext)
    core.info(`Using context: ${kubernetesContext}`)

    const coreV1Api = kc.makeApiClient(k8s.CoreV1Api)
    try {
      await coreV1Api.listNamespace()
      core.info('✅ Successfully connected to cluster')
    } catch (error) {
      throw new Error(
        `Cannot connect to the cluster using context '${kubernetesContext}': ${error}`
      )
    }

    core.endGroup()

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

    core.startGroup('Creating FluxCD resources')

    const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

    const ciPrefixLabel = ciPrefix.replace(/-+$/, '')
    const repositoryLabel = sanitizeLabelValue(
      `${github.context.repo.owner}_${github.context.repo.repo}`
    )

    core.info(`Creating OCIRepository: ${ociRepoName}`)

    const ociRepository: OCIRepository = {
      apiVersion: 'source.toolkit.fluxcd.io/v1',
      kind: 'OCIRepository',
      metadata: {
        name: ociRepoName,
        namespace: 'infra-fluxcd',
        labels: {
          'app.kubernetes.io/managed-by': 'github-actions',
          'app.kubernetes.io/created-by': 'deploy-preview',
          'preview-deployment': 'true',
          'ci-prefix': ciPrefixLabel,
          'github.com/repository': repositoryLabel
        }
      },
      spec: {
        interval: '5m',
        url: `oci://cr.eidp.io/tenant-definitions/${tenantName}`,
        ref: {
          tag: 'latest'
        },
        secretRef: {
          // TODO: We need to this secret name more generic and make sure it exists in all instances to prevent leaking an implementation detail
          //  besides, customers do not have a way to look up this secret name
          name: 'eidp-harbor-pull-credential'
        }
      }
    }

    try {
      await customApi.createNamespacedCustomObject({
        group: 'source.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'ocirepositories',
        body: ociRepository
      })
      core.info('✅ OCIRepository created successfully')
    } catch (error) {
      throw new Error(`Failed to create OCIRepository: ${error}`)
    }

    const gitBranch =
      process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || ''

    const helmReleaseName = `${ciPrefix}${tenantName}`
    const releaseName = `${ciPrefix}${tenantName}-tenant`

    const postBuildSubstitute: Record<string, string> = {
      instanceName: 'eidp',
      clusterName: 'development',
      environmentName: environment,
      helmReleaseName: helmReleaseName,
      releaseName: releaseName,
      gitBranch: gitBranch,
      namespace: namespace,
      namePrefix: ciPrefix,
      objectStoreEndpoint: 'https://core.fuga.cloud:8080'
    }

    if (chartVersion) {
      postBuildSubstitute.chartVersion = chartVersion
    }

    core.info(`Deploying preview tenant: ${kustomizationName}`)

    const kustomization: Kustomization = {
      apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
      kind: 'Kustomization',
      metadata: {
        name: kustomizationName,
        namespace: 'infra-fluxcd',
        labels: {
          'app.kubernetes.io/managed-by': 'github-actions',
          'app.kubernetes.io/created-by': 'deploy-preview',
          'preview-deployment': 'true',
          'ci-prefix': ciPrefixLabel,
          'github.com/repository': repositoryLabel
        }
      },
      spec: {
        serviceAccountName: 'flux-deployment-controller',
        interval: '10m',
        sourceRef: {
          kind: 'OCIRepository',
          name: ociRepoName
        },
        path: './',
        prune: true,
        wait: true,
        timeout: timeout,
        postBuild: {
          substitute: postBuildSubstitute
        }
      }
    }

    try {
      await customApi.createNamespacedCustomObject({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'kustomizations',
        body: kustomization
      })
      core.info('✅ Kustomization created successfully')
    } catch (error) {
      throw new Error(`Failed to create Kustomization: ${error}`)
    }

    core.endGroup()

    core.startGroup('Discovering preview URL')

    let previewUrl = ''

    await sleep(5000)

    try {
      const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api)
      const ingresses = await networkingApi.listNamespacedIngress({ namespace })

      if (ingresses.items.length > 0) {
        core.info(
          `Found ${ingresses.items.length} ingress(es) in namespace ${namespace}`
        )

        const firstIngress = ingresses.items[0]
        const host = firstIngress.spec?.rules?.[0]?.host

        if (host) {
          const hasTls =
            firstIngress.spec?.tls && firstIngress.spec.tls.length > 0

          previewUrl = hasTls ? `https://${host}` : `http://${host}`
          core.info(`✅ Preview URL discovered: ${previewUrl}`)
        } else {
          core.warning('Ingress found but no host configured')
        }
      } else {
        core.warning(`No ingress resources found in namespace ${namespace}`)
        core.info('Preview deployment is ready but no URL is available')
      }
    } catch (error) {
      core.warning(`Failed to discover preview URL: ${error}`)
    }

    core.setOutput('preview-url', previewUrl)
    core.endGroup()

    core.startGroup('Generating GitHub summary')

    await core.summary
      .addHeading('✅ Preview deployment successful', 2)
      .addHeading('Deployment details', 3)
      .addTable([
        [
          { data: 'Field', header: true },
          { data: 'Value', header: true }
        ],
        [{ data: 'Tenant name' }, { data: tenantName }],
        [{ data: 'CI prefix' }, { data: ciPrefix }],
        [{ data: 'Namespace' }, { data: namespace }],
        [{ data: 'OCIRepository' }, { data: ociRepoName }],
        [{ data: 'Kustomization' }, { data: kustomizationName }],
        [{ data: 'Git branch' }, { data: gitBranch }]
      ])
      .addRaw(
        previewUrl
          ? `\n### 🌐 Preview URL\n\n**[${previewUrl}](${previewUrl})**\n`
          : ''
      )
      .addRaw(
        `\n---\n*Deployment timestamp: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC*`
      )
      .write()

    core.endGroup()

    core.info('✅ Preview deployment resources created successfully')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()

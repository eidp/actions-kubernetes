import * as core from '@actions/core'
import * as github from '@actions/github'
import * as k8s from '@kubernetes/client-node'
import { Kustomization, OCIRepository } from './types'
import { sanitizeLabelValue } from './utils'

export async function createOrUpdateCustomObject(
  customApi: k8s.CustomObjectsApi,
  params: {
    group: string
    version: string
    namespace: string
    plural: string
    name: string
    body: any
    resourceType: string
  }
): Promise<void> {
  try {
    await customApi.createNamespacedCustomObject({
      group: params.group,
      version: params.version,
      namespace: params.namespace,
      plural: params.plural,
      body: params.body
    })
    core.info(`✅ ${params.resourceType} created successfully`)
  } catch (error: any) {
    if (error.code === 409) {
      core.info(`${params.resourceType} already exists, updating...`)
      try {
        const existing = (await customApi.getNamespacedCustomObject({
          group: params.group,
          version: params.version,
          namespace: params.namespace,
          plural: params.plural,
          name: params.name
        })) as any

        const updatedBody = {
          ...params.body,
          metadata: {
            ...params.body.metadata,
            resourceVersion: existing.metadata.resourceVersion
          }
        }

        await customApi.replaceNamespacedCustomObject({
          group: params.group,
          version: params.version,
          namespace: params.namespace,
          plural: params.plural,
          name: params.name,
          body: updatedBody
        })
        core.info(`✅ ${params.resourceType} updated successfully`)
      } catch (updateError) {
        throw new Error(
          `Failed to update ${params.resourceType}: ${updateError}`
        )
      }
    } else {
      throw new Error(`Failed to create ${params.resourceType}: ${error}`)
    }
  }
}

export async function verifyKubernetesConnectivity(
  kubernetesContext: string
): Promise<k8s.KubeConfig> {
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
  return kc
}

export async function discoverPreviewURL(
  kc: k8s.KubeConfig,
  namespace: string,
  ingressSelector: string
): Promise<string> {
  core.startGroup('Discovering preview URL')

  let previewUrl = ''

  await new Promise((resolve) => setTimeout(resolve, 5000))

  try {
    const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api)
    const ingresses = await networkingApi.listNamespacedIngress({
      namespace,
      labelSelector: ingressSelector
    })

    if (ingresses.items.length === 0) {
      core.warning(`No ingress resources found in namespace ${namespace}`)
      if (ingressSelector) {
        core.info(`Label selector used: ${ingressSelector}`)
      }
      core.info('Preview deployment is ready but no URL is available')
    } else if (ingresses.items.length > 1 && !ingressSelector) {
      core.setFailed(
        `Found ${ingresses.items.length} ingress resources in namespace ${namespace} but no ingress-selector was provided. ` +
          `Please specify the ingress-selector input with a label selector to select the correct ingress.`
      )
    } else {
      core.info(
        `Found ${ingresses.items.length} ingress(es) in namespace ${namespace}`
      )
      if (ingressSelector) {
        core.info(`Label selector used: ${ingressSelector}`)
      }

      const ingress = ingresses.items[0]
      const host = ingress.spec?.rules?.[0]?.host

      if (host) {
        const hasTls = ingress.spec?.tls && ingress.spec.tls.length > 0

        previewUrl = hasTls ? `https://${host}` : `http://${host}`
        core.info(`✅ Preview URL discovered: ${previewUrl}`)
      } else {
        core.warning('Ingress found but no host configured')
      }
    }
  } catch (error) {
    core.warning(`Failed to discover preview URL: ${error}`)
  }

  core.endGroup()
  return previewUrl
}

export async function createOCIRepository(
  kc: k8s.KubeConfig,
  params: {
    name: string
    tenantName: string
    reference: string
  }
): Promise<void> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
  const ciReferenceLabel = sanitizeLabelValue(params.reference)
  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )

  core.info(`Creating OCIRepository: ${params.name}`)

  const ociRepository: OCIRepository = {
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    kind: 'OCIRepository',
    metadata: {
      name: params.name,
      namespace: 'infra-fluxcd',
      labels: {
        'app.kubernetes.io/managed-by': 'github-actions',
        'app.kubernetes.io/created-by': 'deploy-preview',
        'eidp.com/preview-deployment': 'true',
        'eidp.com/ci-reference': ciReferenceLabel,
        'eidp.com/repository': repositoryLabel
      }
    },
    spec: {
      interval: '5m',
      url: `oci://cr.eidp.io/tenant-definitions/${params.tenantName}`,
      ref: {
        tag: 'latest'
      },
      secretRef: {
        name: 'eidp-harbor-pull-credential'
      }
    }
  }

  await createOrUpdateCustomObject(customApi, {
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'ocirepositories',
    name: params.name,
    body: ociRepository,
    resourceType: 'OCIRepository'
  })
}

export async function createKustomization(
  kc: k8s.KubeConfig,
  params: {
    name: string
    ociRepoName: string
    tenantName: string
    reference: string
    ciPrefix: string
    namespace: string
    environment: string
    gitBranch: string
    chartVersion?: string
    timeout: string
  }
): Promise<void> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
  const ciReferenceLabel = sanitizeLabelValue(params.reference)
  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )

  const helmReleaseName = `${params.ciPrefix}${params.tenantName}`
  const releaseName = `${params.ciPrefix}${params.tenantName}-tenant`

  const postBuildSubstitute: Record<string, string> = {
    instanceName: 'eidp',
    clusterName: 'development',
    environmentName: params.environment,
    helmReleaseName: helmReleaseName,
    releaseName: releaseName,
    gitBranch: params.gitBranch,
    namespace: params.namespace,
    namePrefix: params.ciPrefix,
    objectStoreEndpoint: 'https://core.fuga.cloud:8080'
  }

  if (params.chartVersion) {
    postBuildSubstitute.chartVersion = params.chartVersion
  }

  core.info(`Deploying preview tenant: ${params.name}`)

  const kustomization: Kustomization = {
    apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
    kind: 'Kustomization',
    metadata: {
      name: params.name,
      namespace: 'infra-fluxcd',
      labels: {
        'app.kubernetes.io/managed-by': 'github-actions',
        'app.kubernetes.io/created-by': 'deploy-preview',
        'eidp.com/preview-deployment': 'true',
        'eidp.com/ci-reference': ciReferenceLabel,
        'eidp.com/repository': repositoryLabel
      }
    },
    spec: {
      serviceAccountName: 'flux-deployment-controller',
      interval: '10m',
      sourceRef: {
        kind: 'OCIRepository',
        name: params.ociRepoName
      },
      path: './',
      prune: true,
      wait: true,
      timeout: params.timeout,
      postBuild: {
        substitute: postBuildSubstitute
      }
    }
  }

  await createOrUpdateCustomObject(customApi, {
    group: 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'kustomizations',
    name: params.name,
    body: kustomization,
    resourceType: 'Kustomization'
  })
}

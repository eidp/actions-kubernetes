import * as core from '@actions/core'
import * as github from '@actions/github'
import * as k8s from '@kubernetes/client-node'
import { PatchStrategy } from '@kubernetes/client-node'
import { Kustomization, OCIRepository } from './types'
import { sanitizeLabelValue } from './utils'
import { Labels } from '@actions-kubernetes/shared/constants'

export interface TenantsReplacementConfig {
  instanceName: string
  clusterName: string
  objectStoreEndpoint: string
}

export async function readTenantsReplacementConfig(
  kc: k8s.KubeConfig
): Promise<TenantsReplacementConfig> {
  const coreV1Api = kc.makeApiClient(k8s.CoreV1Api)

  try {
    const configMap = await coreV1Api.readNamespacedConfigMap({
      name: 'tenants-replacement-config',
      namespace: 'infra-fluxcd'
    })

    const instanceName = configMap.data?.instanceName
    const clusterName = configMap.data?.clusterName
    const objectStoreEndpoint = configMap.data?.objectStoreEndpoint

    if (!instanceName || !clusterName || !objectStoreEndpoint) {
      throw new Error(
        `ConfigMap 'tenants-replacement-config' is missing required keys. Found keys: ${Object.keys(configMap.data || {}).join(', ')}`
      )
    }

    core.info(
      `Read tenant replacement config: instanceName=${instanceName}, clusterName=${clusterName}, objectStoreEndpoint=${objectStoreEndpoint}`
    )

    return { instanceName, clusterName, objectStoreEndpoint }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to read ConfigMap 'tenants-replacement-config' from namespace 'infra-fluxcd': ${error.message}`
      )
    }
    throw error
  }
}

export async function applyCustomObject(
  kc: k8s.KubeConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  resourceType: string
): Promise<void> {
  const client = k8s.KubernetesObjectApi.makeApiClient(kc)

  await client.patch(
    body,
    undefined, // pretty
    undefined, // dryRun
    'deploy-preview-action', // fieldManager (identifies our action)
    true, // force (take ownership of conflicting fields)
    PatchStrategy.ServerSideApply
  )
  core.info(`✅ ${resourceType} applied successfully`)
}

export async function createOCIRepository(
  kc: k8s.KubeConfig,
  params: {
    name: string
    tenantName: string
    reference: string
    environment: string
  }
): Promise<void> {
  const ciReferenceLabel = sanitizeLabelValue(params.reference)
  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )
  const environmentLabel = sanitizeLabelValue(params.environment)

  core.info(`Creating OCIRepository: ${params.name}`)

  const ociRepository: OCIRepository = {
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    kind: 'OCIRepository',
    metadata: {
      name: params.name,
      namespace: 'infra-fluxcd',
      labels: {
        [Labels.MANAGED_BY]: 'github-actions',
        [Labels.CREATED_BY]: 'deploy-preview',
        [Labels.PREVIEW_DEPLOYMENT]: 'true',
        [Labels.CI_REFERENCE]: ciReferenceLabel,
        [Labels.REPOSITORY]: repositoryLabel,
        [Labels.ENVIRONMENT]: environmentLabel
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

  await applyCustomObject(kc, ociRepository, 'OCIRepository')
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
    instanceName: string
    clusterName: string
    objectStoreEndpoint: string
  }
): Promise<void> {
  const ciReferenceLabel = sanitizeLabelValue(params.reference)
  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )
  const environmentLabel = sanitizeLabelValue(params.environment)

  const helmReleaseName = `${params.ciPrefix}${params.tenantName}`
  const releaseName = `${params.ciPrefix}${params.tenantName}-tenant`

  const postBuildSubstitute: Record<string, string> = {
    instanceName: params.instanceName,
    clusterName: params.clusterName,
    environmentName: params.environment,
    helmReleaseName: helmReleaseName,
    releaseName: releaseName,
    gitBranch: params.gitBranch,
    namespace: params.namespace,
    namePrefix: params.ciPrefix,
    objectStoreEndpoint: params.objectStoreEndpoint
  }

  if (params.chartVersion) {
    postBuildSubstitute.appChartVersion = params.chartVersion
  }

  core.info(`Deploying preview tenant: ${params.name}`)

  const kustomization: Kustomization = {
    apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
    kind: 'Kustomization',
    metadata: {
      name: params.name,
      namespace: 'infra-fluxcd',
      labels: {
        [Labels.MANAGED_BY]: 'github-actions',
        [Labels.CREATED_BY]: 'deploy-preview',
        [Labels.PREVIEW_DEPLOYMENT]: 'true',
        [Labels.CI_REFERENCE]: ciReferenceLabel,
        [Labels.REPOSITORY]: repositoryLabel,
        [Labels.ENVIRONMENT]: environmentLabel
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

  await applyCustomObject(kc, kustomization, 'Kustomization')
}

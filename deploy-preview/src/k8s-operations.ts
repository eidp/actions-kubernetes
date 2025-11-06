import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import {
  KubernetesClient,
  FluxClient,
  OCIRepository,
  Kustomization,
  Labels,
  FLUXCD_NAMESPACE,
  TENANT_REPLACEMENT_CONFIG
} from '@actions-kubernetes/k8s-client'
import { sanitizeLabelValue } from '@actions-kubernetes/shared/string-utils'
import * as github from '@actions/github'
import { TenantsReplacementConfig } from './types'

function getTenantReplacementConfig(
  data: Record<string, string> | undefined
): TenantsReplacementConfig {
  if (!data) {
    throw new Error(
      `ConfigMap '${TENANT_REPLACEMENT_CONFIG}' has no data section`
    )
  }

  const requiredKeys: (keyof TenantsReplacementConfig)[] = [
    'instanceName',
    'clusterName',
    'objectStoreEndpoint'
  ]

  const missingKeys = requiredKeys.filter((key) => !data[key])

  if (missingKeys.length > 0) {
    const foundKeys = Object.keys(data).join(', ')
    throw new Error(
      `ConfigMap '${TENANT_REPLACEMENT_CONFIG}' is missing required keys: ${missingKeys.join(', ')}. Found keys: ${foundKeys}`
    )
  }

  return {
    instanceName: data.instanceName,
    clusterName: data.clusterName,
    objectStoreEndpoint: data.objectStoreEndpoint
  }
}

export async function readTenantsReplacementConfig(
  kc: k8s.KubeConfig
): Promise<TenantsReplacementConfig> {
  const k8sClient = new KubernetesClient(kc)

  try {
    const configMap = await k8sClient.readConfigMap(
      TENANT_REPLACEMENT_CONFIG,
      FLUXCD_NAMESPACE
    )

    const config = getTenantReplacementConfig(configMap.data)

    core.info(
      `Read tenant replacement config: instanceName=${config.instanceName}, clusterName=${config.clusterName}, objectStoreEndpoint=${config.objectStoreEndpoint}`
    )

    return config
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to read ConfigMap '${TENANT_REPLACEMENT_CONFIG}' from namespace '${FLUXCD_NAMESPACE}': ${error.message}`
      )
    }
    throw error
  }
}

export async function createOCIRepository(
  kc: k8s.KubeConfig,
  params: {
    name: string
    tenantName: string
    reference: string
    environment: string
    prNumber: number | null
  }
): Promise<void> {
  const fluxClient = new FluxClient(kc)

  core.info(`Creating OCIRepository: ${params.name}`)

  const ciReferenceLabel = sanitizeLabelValue(params.reference)
  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )
  const environmentLabel = sanitizeLabelValue(params.environment)
  const prNumberLabel = sanitizeLabelValue('' + (params.prNumber || ''))

  const ociRepository: OCIRepository = {
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    kind: 'OCIRepository',
    metadata: {
      name: params.name,
      namespace: FLUXCD_NAMESPACE,
      labels: {
        [Labels.MANAGED_BY]: 'github-actions',
        [Labels.CREATED_BY]: 'deploy-preview',
        [Labels.PREVIEW_DEPLOYMENT]: 'true',
        [Labels.CI_REFERENCE]: ciReferenceLabel,
        [Labels.REPOSITORY]: repositoryLabel,
        [Labels.ENVIRONMENT]: environmentLabel,
        [Labels.PR]: prNumberLabel
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

  await fluxClient.createOCIRepository(ociRepository, 'deploy-preview-action')
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
  const fluxClient = new FluxClient(kc)

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

  const ciReferenceLabel = sanitizeLabelValue(params.reference)
  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )
  const environmentLabel = sanitizeLabelValue(params.environment)

  const kustomization: Kustomization = {
    apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
    kind: 'Kustomization',
    metadata: {
      name: params.name,
      namespace: FLUXCD_NAMESPACE,
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

  await fluxClient.createKustomization(kustomization, 'deploy-preview-action')
}

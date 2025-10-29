import * as core from '@actions/core'
import * as github from '@actions/github'
import * as k8s from '@kubernetes/client-node'
import { Kustomization, OCIRepository } from './types'
import { sanitizeLabelValue } from './utils'
import { Labels } from '../../shared/src/constants'

export async function createOrUpdateCustomObject(
  customApi: k8s.CustomObjectsApi,
  params: {
    group: string
    version: string
    namespace: string
    plural: string
    name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 409) {
      core.info(`${params.resourceType} already exists, updating...`)
      try {
        const existing = (await customApi.getNamespacedCustomObject({
          group: params.group,
          version: params.version,
          namespace: params.namespace,
          plural: params.plural,
          name: params.name
        })) as { metadata: { resourceVersion: string } }

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

export async function createOCIRepository(
  kc: k8s.KubeConfig,
  params: {
    name: string
    tenantName: string
    reference: string
    environment: string
  }
): Promise<void> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
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
  const environmentLabel = sanitizeLabelValue(params.environment)

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

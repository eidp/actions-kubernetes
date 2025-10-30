import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import parseDuration from 'parse-duration'
import { Kustomization, OCIRepository } from './types'
import { Labels } from '../../shared/src/constants'

export async function verifyKubernetesConnectivity(
  kubernetesContext: string
): Promise<k8s.KubeConfig> {
  core.startGroup('Verifying Kubernetes connectivity')

  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()

  const contexts = kc.getContexts()
  const contextExists = contexts.some((ctx) => ctx.name === kubernetesContext)

  if (!contextExists) {
    throw new Error(
      `Kubernetes context '${kubernetesContext}' not found. Available contexts: ${contexts.map((c) => c.name).join(', ')}`
    )
  }

  kc.setCurrentContext(kubernetesContext)

  core.info(`Using context: ${kubernetesContext}`)

  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

  try {
    await customApi.listNamespacedCustomObject({
      group: 'source.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'ocirepositories',
      limit: 1
    })
  } catch (error: unknown) {
    const hasStatusCode = error instanceof Error && 'statusCode' in error
    const statusCode = hasStatusCode
      ? (error as { statusCode: number }).statusCode
      : null

    if (statusCode === 403) {
      throw new Error(
        'Insufficient permissions to list OCIRepository resources in namespace infra-fluxcd'
      )
    }
    throw error
  }

  try {
    await customApi.listNamespacedCustomObject({
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'kustomizations',
      limit: 1
    })
  } catch (error: unknown) {
    const hasStatusCode = error instanceof Error && 'statusCode' in error
    const statusCode = hasStatusCode
      ? (error as { statusCode: number }).statusCode
      : null

    if (statusCode === 403) {
      throw new Error(
        'Insufficient permissions to list Kustomization resources in namespace infra-fluxcd'
      )
    }
    throw error
  }

  core.info('✅ Successfully connected to cluster with required permissions')
  core.endGroup()

  return kc
}

export async function findResourcesByLabel(
  kc: k8s.KubeConfig,
  labelSelector: string
): Promise<{
  kustomizations: Kustomization[]
  ociRepositories: OCIRepository[]
}> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

  const kustomizationsResponse = (await customApi.listNamespacedCustomObject({
    group: 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'kustomizations',
    labelSelector
  })) as { items: Kustomization[] }

  const ociReposResponse = (await customApi.listNamespacedCustomObject({
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'ocirepositories',
    labelSelector
  })) as { items: OCIRepository[] }

  return {
    kustomizations: kustomizationsResponse.items,
    ociRepositories: ociReposResponse.items
  }
}

export async function listKustomizations(
  kc: k8s.KubeConfig,
  labelSelector: string
): Promise<Kustomization[]> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

  const response = (await customApi.listNamespacedCustomObject({
    group: 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'kustomizations',
    labelSelector
  })) as { items: Kustomization[] }

  return response.items
}

export async function deleteKustomization(
  kc: k8s.KubeConfig,
  name: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return

  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

  try {
    await customApi.deleteNamespacedCustomObject({
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'kustomizations',
      name,
      propagationPolicy: 'Background'
    })
    core.info(`  ✅ Deleted Kustomization: ${name}`)
  } catch (error: unknown) {
    const hasCode = error instanceof Error && 'code' in error
    const code = hasCode ? (error as { code: number }).code : null

    if (code === 404) {
      core.info(`  ℹ️ Kustomization ${name} already deleted`)
    } else {
      throw error
    }
  }
}

export async function deleteOCIRepository(
  kc: k8s.KubeConfig,
  name: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return

  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

  try {
    await customApi.deleteNamespacedCustomObject({
      group: 'source.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'ocirepositories',
      name,
      propagationPolicy: 'Background',
      body: {
        apiVersion: 'v1',
        kind: 'DeleteOptions',
        propagationPolicy: 'Background'
      }
    })
    core.info(`  ✅ Deleted OCIRepository: ${name}`)
  } catch (error: unknown) {
    const hasCode = error instanceof Error && 'code' in error
    const code = hasCode ? (error as { code: number }).code : null
    const message = error instanceof Error ? error.message : String(error)

    if (code === 404) {
      core.info(`  ℹ️ OCIRepository ${name} already deleted`)
    } else {
      core.warning(`Failed to delete OCIRepository ${name}: ${message}`)
    }
  }
}

export async function deleteMatchingOCIRepository(
  kc: k8s.KubeConfig,
  ciReferenceLabel: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return

  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

  try {
    const response = (await customApi.listNamespacedCustomObject({
      group: 'source.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'ocirepositories',
      labelSelector: `${Labels.PREVIEW_DEPLOYMENT}=true,${Labels.CI_REFERENCE}=${ciReferenceLabel}`
    })) as { items: OCIRepository[] }

    for (const oci of response.items) {
      await deleteOCIRepository(kc, oci.metadata.name, dryRun)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    core.warning(
      `Failed to find/delete matching OCIRepository for ci-reference ${ciReferenceLabel}: ${message}`
    )
  }
}

export async function deleteNamespace(
  kc: k8s.KubeConfig,
  name: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return

  const coreApi = kc.makeApiClient(k8s.CoreV1Api)

  try {
    await coreApi.deleteNamespace({
      name,
      propagationPolicy: 'Foreground',
      body: {
        apiVersion: 'v1',
        kind: 'DeleteOptions',
        propagationPolicy: 'Foreground'
      }
    })
    core.info(`  ✅ Deleted namespace: ${name}`)
  } catch (error: unknown) {
    const hasCode = error instanceof Error && 'code' in error
    const code = hasCode ? (error as { code: number }).code : null

    if (code === 404) {
      core.info(`  ℹ️ Namespace ${name} already deleted`)
    } else {
      throw error
    }
  }
}

export function getNamespaceFromKustomization(
  kustomization: Kustomization
): string | undefined {
  return kustomization.spec?.postBuild?.substitute?.namespace
}

export async function waitForDeletion(
  kc: k8s.KubeConfig,
  kustomizations: Kustomization[],
  ociRepositories: OCIRepository[],
  timeout: string
): Promise<void> {
  core.info('Waiting for resources to be fully deleted...')

  const timeoutMs = parseTimeout(timeout)
  const startTime = Date.now()

  for (const kust of kustomizations) {
    await waitForKustomizationDeletion(kc, kust.metadata.name, timeout)
    if (Date.now() - startTime > timeoutMs) {
      core.warning('Timeout reached while waiting for deletion')
      return
    }
  }

  for (const oci of ociRepositories) {
    await waitForOCIRepositoryDeletion(kc, oci.metadata.name, timeout)
    if (Date.now() - startTime > timeoutMs) {
      core.warning('Timeout reached while waiting for deletion')
      return
    }
  }

  core.info('✅ Resources deleted successfully')
}

export async function waitForKustomizationDeletion(
  kc: k8s.KubeConfig,
  name: string,
  timeout: string
): Promise<void> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
  const timeoutMs = parseTimeout(timeout)
  const startTime = Date.now()
  const pollInterval = 2000

  while (Date.now() - startTime < timeoutMs) {
    try {
      await customApi.getNamespacedCustomObject({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'kustomizations',
        name
      })
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    } catch (error: unknown) {
      const hasCode = error instanceof Error && 'code' in error
      const code = hasCode ? (error as { code: number }).code : null

      if (code === 404) {
        return
      }
      throw error
    }
  }
}

async function waitForOCIRepositoryDeletion(
  kc: k8s.KubeConfig,
  name: string,
  timeout: string
): Promise<void> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
  const timeoutMs = parseTimeout(timeout)
  const startTime = Date.now()
  const pollInterval = 2000

  while (Date.now() - startTime < timeoutMs) {
    try {
      await customApi.getNamespacedCustomObject({
        group: 'source.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'ocirepositories',
        name
      })
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    } catch (error: unknown) {
      const hasCode = error instanceof Error && 'code' in error
      const code = hasCode ? (error as { code: number }).code : null

      if (code === 404) {
        return
      }
      throw error
    }
  }
}

export async function waitForNamespaceDeletion(
  kc: k8s.KubeConfig,
  name: string,
  timeout: string
): Promise<void> {
  core.info(`Waiting for namespace '${name}' to be fully deleted...`)
  const coreApi = kc.makeApiClient(k8s.CoreV1Api)
  const timeoutMs = parseTimeout(timeout)
  const startTime = Date.now()
  const pollInterval = 2000

  while (Date.now() - startTime < timeoutMs) {
    try {
      await coreApi.readNamespace({ name })
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    } catch (error: unknown) {
      const hasCode = error instanceof Error && 'code' in error
      const code = hasCode ? (error as { code: number }).code : null

      if (code === 404) {
        core.info(`✅ Namespace '${name}' fully deleted`)
        return
      }
      throw error
    }
  }
  core.warning(`Timeout waiting for namespace '${name}' deletion`)
}

function parseTimeout(timeout: string): number {
  const ms = parseDuration(timeout)
  return ms ?? 300000 // Default to 5 minutes if parsing fails
}

import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import parseDuration from 'parse-duration'
import { Kustomization, OCIRepository } from './types'
import { FLUXCD_NAMESPACE } from '@actions-kubernetes/shared/constants'
import { Labels } from '@actions-kubernetes/shared/labels'

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
    namespace: FLUXCD_NAMESPACE,
    plural: 'kustomizations',
    labelSelector
  })) as { items: Kustomization[] }

  const ociReposResponse = (await customApi.listNamespacedCustomObject({
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    namespace: FLUXCD_NAMESPACE,
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
    namespace: FLUXCD_NAMESPACE,
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
      namespace: FLUXCD_NAMESPACE,
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
      namespace: FLUXCD_NAMESPACE,
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
      namespace: FLUXCD_NAMESPACE,
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
        namespace: FLUXCD_NAMESPACE,
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
        namespace: FLUXCD_NAMESPACE,
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

function parseTimeout(timeout: string): number {
  const ms = parseDuration(timeout)
  return ms ?? 300000 // Default to 5 minutes if parsing fails
}

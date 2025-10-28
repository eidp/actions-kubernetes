import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import {
  FluxResource,
  HelmRelease,
  KustomizationResource,
  DeploymentStatus,
  isResourceReady,
  createDeploymentStatus
} from './types'
import { ANSI_RED, ANSI_RESET } from '../../shared/src/constants'
import { parseFluxResourceInput } from './flux-resource-spec'
import type { FluxResourceSpec } from './flux-resource-spec'

export { parseFluxResourceInput }
export type { FluxResourceSpec }

export async function waitForResourceReady(
  kc: k8s.KubeConfig,
  namespace: string,
  spec: FluxResourceSpec,
  timeout: number
): Promise<DeploymentStatus> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
  const watch = new k8s.Watch(kc)

  // First, check if resource exists and get current state
  try {
    const resource = (await customApi.getNamespacedCustomObject({
      group: spec.group,
      version: spec.version,
      namespace: namespace,
      plural: spec.plural,
      name: spec.name
    })) as FluxResource

    // If already ready, return immediately
    if (isResourceReady(resource)) {
      core.info(`✅ ${spec.kind} '${spec.name}' is already ready`)
      return createDeploymentStatus(resource)
    }

    core.info(
      `${spec.kind} '${spec.name}' is not ready yet, waiting for Ready condition...`
    )
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404) {
        throw new Error(
          `${ANSI_RED}ERROR ❌ ${spec.kind} '${spec.name}' does not exist in namespace '${namespace}'${ANSI_RESET}`
        )
      }
    }
    throw new Error(
      `Failed to get ${spec.kind} '${spec.name}': ${error instanceof Error ? error.message : String(error)}`
    )
  }

  // Watch for resource changes
  return new Promise((resolve, reject) => {
    const watchPath = `/apis/${spec.group}/${spec.version}/namespaces/${namespace}/${spec.plural}`

    let timeoutHandle: NodeJS.Timeout
    let watchRequest: { abort: () => void } | null = null

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      if (watchRequest) {
        watchRequest.abort()
      }
    }

    watch
      .watch(
        watchPath,
        {
          allowWatchBookmarks: true,
          fieldSelector: `metadata.name=${spec.name}`
        },
        // Event callback
        (type, apiObj) => {
          if (type === 'ADDED' || type === 'MODIFIED') {
            const resource = apiObj as FluxResource
            if (resource.metadata.name === spec.name) {
              if (isResourceReady(resource)) {
                cleanup()
                core.info(
                  `✅ ${spec.kind} '${spec.name}' in namespace '${namespace}' is ready`
                )
                resolve(createDeploymentStatus(resource))
              }
            }
          }
        },
        // Done callback
        (err) => {
          cleanup()
          if (err) {
            reject(
              new Error(
                `Watch error for ${spec.kind} '${spec.name}': ${err instanceof Error ? err.message : String(err)}`
              )
            )
          }
        }
      )
      .then((req) => {
        watchRequest = req
        // Set up timeout to abort watch
        timeoutHandle = setTimeout(() => {
          if (watchRequest) {
            watchRequest.abort()
          }
          reject(
            new Error(
              `${ANSI_RED}ERROR ❌ ${spec.kind} '${spec.name}' is not ready in namespace '${namespace}' within timeout${ANSI_RESET}`
            )
          )
        }, timeout)
      })
      .catch((err) => {
        cleanup()
        reject(
          new Error(
            `Failed to start watch for ${spec.kind} '${spec.name}': ${err instanceof Error ? err.message : String(err)}`
          )
        )
      })
  })
}

export async function listAndWatchAllResources(
  kc: k8s.KubeConfig,
  namespace: string,
  timeout: number
): Promise<DeploymentStatus[]> {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

  // List all HelmReleases and Kustomizations
  const helmReleases = (await customApi.listNamespacedCustomObject({
    group: 'helm.toolkit.fluxcd.io',
    version: 'v2',
    namespace: namespace,
    plural: 'helmreleases'
  })) as { items: HelmRelease[] }

  const kustomizations = (await customApi.listNamespacedCustomObject({
    group: 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    namespace: namespace,
    plural: 'kustomizations'
  })) as { items: KustomizationResource[] }

  const allResources: FluxResource[] = [
    ...helmReleases.items,
    ...kustomizations.items
  ]

  if (allResources.length === 0) {
    core.warning(
      `⚠️ No HelmReleases or Kustomizations found in namespace '${namespace}'`
    )
    return []
  }

  core.info(
    `Found ${helmReleases.items.length} HelmRelease(s) and ${kustomizations.items.length} Kustomization(s) in namespace '${namespace}'`
  )

  // Check if all are already ready
  const notReadyResources = allResources.filter((r) => !isResourceReady(r))
  if (notReadyResources.length === 0) {
    core.info('✅ All resources are already ready')
    return allResources.map(createDeploymentStatus)
  }

  core.info(
    `${notReadyResources.length} resource(s) not ready yet, watching for changes...`
  )

  // Watch all resources until all are ready or timeout
  const watch = new k8s.Watch(kc)
  const readyResources = new Set(
    allResources.filter(isResourceReady).map((r) => r.metadata.name)
  )
  const targetCount = allResources.length

  return new Promise((resolve, reject) => {
    const watchRequests: Array<{ abort: () => void }> = []
    // eslint-disable-next-line prefer-const
    let timeoutHandle: NodeJS.Timeout

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      watchRequests.forEach((req) => req.abort())
    }

    const checkComplete = async () => {
      if (readyResources.size === targetCount) {
        cleanup()
        core.info('✅ All resources are ready')
        // Fetch final state of all resources
        const finalHelmReleases = (await customApi.listNamespacedCustomObject({
          group: 'helm.toolkit.fluxcd.io',
          version: 'v2',
          namespace: namespace,
          plural: 'helmreleases'
        })) as { items: HelmRelease[] }

        const finalKustomizations = (await customApi.listNamespacedCustomObject(
          {
            group: 'kustomize.toolkit.fluxcd.io',
            version: 'v1',
            namespace: namespace,
            plural: 'kustomizations'
          }
        )) as { items: KustomizationResource[] }

        const finalResources: FluxResource[] = [
          ...finalHelmReleases.items,
          ...finalKustomizations.items
        ]
        resolve(finalResources.map(createDeploymentStatus))
      }
    }

    // Watch HelmReleases
    if (helmReleases.items.length > 0) {
      watch
        .watch(
          `/apis/helm.toolkit.fluxcd.io/v2/namespaces/${namespace}/helmreleases`,
          { allowWatchBookmarks: true },
          (type, apiObj) => {
            if (type === 'ADDED' || type === 'MODIFIED') {
              const resource = apiObj as HelmRelease
              if (isResourceReady(resource)) {
                readyResources.add(resource.metadata.name)
                checkComplete()
              }
            }
          },
          (err) => {
            if (err) {
              cleanup()
              reject(new Error(`Watch error for HelmReleases: ${err}`))
            }
          }
        )
        .then((req) => watchRequests.push(req))
        .catch((err) => {
          cleanup()
          reject(new Error(`Failed to start watch for HelmReleases: ${err}`))
        })
    }

    // Watch Kustomizations
    if (kustomizations.items.length > 0) {
      watch
        .watch(
          `/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/${namespace}/kustomizations`,
          { allowWatchBookmarks: true },
          (type, apiObj) => {
            if (type === 'ADDED' || type === 'MODIFIED') {
              const resource = apiObj as KustomizationResource
              if (isResourceReady(resource)) {
                readyResources.add(resource.metadata.name)
                checkComplete()
              }
            }
          },
          (err) => {
            if (err) {
              cleanup()
              reject(new Error(`Watch error for Kustomizations: ${err}`))
            }
          }
        )
        .then((req) => watchRequests.push(req))
        .catch((err) => {
          cleanup()
          reject(new Error(`Failed to start watch for Kustomizations: ${err}`))
        })
    }

    // Set up timeout
    timeoutHandle = setTimeout(async () => {
      cleanup()
      // Fetch current state to show what's not ready
      const currentHelmReleases = (await customApi.listNamespacedCustomObject({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        namespace: namespace,
        plural: 'helmreleases'
      })) as { items: HelmRelease[] }

      const currentKustomizations = (await customApi.listNamespacedCustomObject(
        {
          group: 'kustomize.toolkit.fluxcd.io',
          version: 'v1',
          namespace: namespace,
          plural: 'kustomizations'
        }
      )) as { items: KustomizationResource[] }

      const currentResources: FluxResource[] = [
        ...currentHelmReleases.items,
        ...currentKustomizations.items
      ]

      const statuses = currentResources.map(createDeploymentStatus)
      const notReady = statuses.filter((s) => s.ready !== 'True')

      core.error(
        `${ANSI_RED}ERROR ❌ Not all flux resources are ready in namespace '${namespace}' within timeout${ANSI_RESET}`
      )
      core.startGroup('Resources not ready')
      notReady.forEach((s) => {
        core.error(`  ${s.type}/${s.name}: ${s.message}`)
      })
      core.endGroup()

      reject(
        new Error(
          `Not all flux resources are ready in namespace '${namespace}' within timeout`
        )
      )
    }, timeout)
  })
}

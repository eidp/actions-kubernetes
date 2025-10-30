import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { FluxResource, FluxResourceSpec, DeploymentStatus } from './types'
import {
  isResourceReady,
  createDeploymentStatus,
  getChartVersionFromResource
} from './utils'
import { ANSI_RED, ANSI_RESET } from '@actions-kubernetes/shared/constants'

export function parseFluxResourceInput(fluxResource: string): FluxResourceSpec {
  const parts = fluxResource.split('/')
  if (parts.length !== 2) {
    throw new Error(
      `Invalid flux-resource format: ${fluxResource}. Expected format: <type>/<name> (e.g., helmreleases/my-release or ks/my-kustomization)`
    )
  }

  const [resourceType, name] = parts

  const resourceMap: Record<string, Omit<FluxResourceSpec, 'name'>> = {
    helmrelease: {
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      plural: 'helmreleases',
      kind: 'HelmRelease'
    },
    helmreleases: {
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      plural: 'helmreleases',
      kind: 'HelmRelease'
    },
    hr: {
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      plural: 'helmreleases',
      kind: 'HelmRelease'
    },
    kustomization: {
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      plural: 'kustomizations',
      kind: 'Kustomization'
    },
    kustomizations: {
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      plural: 'kustomizations',
      kind: 'Kustomization'
    },
    ks: {
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      plural: 'kustomizations',
      kind: 'Kustomization'
    }
  }

  const spec = resourceMap[resourceType.toLowerCase()]
  if (!spec) {
    throw new Error(
      `Unsupported flux resource type: ${resourceType}. Supported types: helmrelease/helmreleases (hr), kustomization/kustomizations (ks)`
    )
  }

  return {
    ...spec,
    name
  }
}

export async function waitForResourceReady(
  kc: k8s.KubeConfig,
  namespace: string,
  spec: FluxResourceSpec,
  timeout: number,
  chartVersion?: string
): Promise<DeploymentStatus> {
  // Helper function to check if resource meets all criteria
  const isResourceFullyReady = (resource: FluxResource): boolean => {
    if (!isResourceReady(resource)) {
      return false
    }

    // If chartVersion specified and this is a HelmRelease, check version
    if (chartVersion && spec.kind === 'HelmRelease') {
      const deployedVersion = getChartVersionFromResource(resource)
      return deployedVersion === chartVersion
    }

    return true
  }

  // Wait for resource to be ready
  if (chartVersion && spec.kind === 'HelmRelease') {
    core.info(
      `Waiting for ${spec.kind} '${spec.name}' to be ready with chart version ${chartVersion}...`
    )
  } else {
    core.info(`Waiting for ${spec.kind} '${spec.name}' to be ready...`)
  }

  const startTime = Date.now()

  // Watch with retry logic
  return new Promise((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout
    let watchRequest: { abort: () => void } | null = null
    let retryCount = 0
    const maxRetries = 5

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      if (watchRequest) {
        watchRequest.abort()
      }
    }

    const startWatch = () => {
      const watch = new k8s.Watch(kc)
      const watchPath = `/apis/${spec.group}/${spec.version}/namespaces/${namespace}/${spec.plural}`

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
                if (isResourceFullyReady(resource)) {
                  cleanup()
                  if (chartVersion && spec.kind === 'HelmRelease') {
                    core.info(
                      `✅ ${spec.kind} '${spec.name}' in namespace '${namespace}' is ready with chart version ${chartVersion}`
                    )
                  } else {
                    core.info(
                      `✅ ${spec.kind} '${spec.name}' in namespace '${namespace}' is ready`
                    )
                  }
                  resolve(createDeploymentStatus(resource))
                }
              }
            }
          },
          // Done callback
          (err) => {
            if (err) {
              // Ignore AbortError since we intentionally abort watches
              if (
                err instanceof Error &&
                (err.name === 'AbortError' || err.message.includes('aborted'))
              ) {
                return
              }

              // Check if we have time left and retries available
              const elapsed = Date.now() - startTime
              if (elapsed < timeout && retryCount < maxRetries) {
                retryCount++
                const retryDelay = Math.min(
                  1000 * Math.pow(2, retryCount - 1),
                  10000
                )
                core.info(
                  `Watch connection closed (${err instanceof Error ? err.message : String(err)}), retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})...`
                )
                setTimeout(startWatch, retryDelay)
                return
              }

              cleanup()
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
          // Set up timeout to abort watch (only on first attempt)
          if (!timeoutHandle) {
            timeoutHandle = setTimeout(() => {
              cleanup()
              const errorMsg =
                chartVersion && spec.kind === 'HelmRelease'
                  ? `${ANSI_RED}ERROR ❌ ${spec.kind} '${spec.name}' did not become ready with chart version ${chartVersion} in namespace '${namespace}' within timeout${ANSI_RESET}`
                  : `${ANSI_RED}ERROR ❌ ${spec.kind} '${spec.name}' is not ready in namespace '${namespace}' within timeout${ANSI_RESET}`
              reject(new Error(errorMsg))
            }, timeout)
          }
        })
        .catch((err) => {
          // Check if we have time left and retries available
          const elapsed = Date.now() - startTime
          if (elapsed < timeout && retryCount < maxRetries) {
            retryCount++
            const retryDelay = Math.min(
              1000 * Math.pow(2, retryCount - 1),
              10000
            )
            core.info(
              `Failed to start watch (${err instanceof Error ? err.message : String(err)}), retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})...`
            )
            setTimeout(startWatch, retryDelay)
            return
          }

          cleanup()
          reject(
            new Error(
              `Failed to start watch for ${spec.kind} '${spec.name}': ${err instanceof Error ? err.message : String(err)}`
            )
          )
        })
    }

    // Start the initial watch
    startWatch()
  })
}

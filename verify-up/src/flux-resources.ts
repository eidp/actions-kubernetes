import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { FluxResource, FluxResourceSpec, DeploymentStatus } from './types'
import {
  isResourceReady,
  createDeploymentStatus,
  getChartVersionFromResource
} from './utils'
import { ANSI_RED, ANSI_RESET } from '../../shared/src/constants'

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
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
  const watch = new k8s.Watch(kc)

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

  // First, check if resource exists and get current state
  try {
    const resource = (await customApi.getNamespacedCustomObject({
      group: spec.group,
      version: spec.version,
      namespace: namespace,
      plural: spec.plural,
      name: spec.name
    })) as FluxResource

    // If already ready (and has correct version if specified), return immediately
    if (isResourceFullyReady(resource)) {
      if (chartVersion && spec.kind === 'HelmRelease') {
        core.info(
          `✅ ${spec.kind} '${spec.name}' is already ready with chart version ${chartVersion}`
        )
      } else {
        core.info(`✅ ${spec.kind} '${spec.name}' is already ready`)
      }
      return createDeploymentStatus(resource)
    }

    if (chartVersion && spec.kind === 'HelmRelease') {
      const deployedVersion = getChartVersionFromResource(resource)
      core.info(
        `${spec.kind} '${spec.name}' is not ready yet (current version: ${deployedVersion || 'unknown'}, expected: ${chartVersion}), waiting...`
      )
    } else {
      core.info(
        `${spec.kind} '${spec.name}' is not ready yet, waiting for Ready condition...`
      )
    }
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
          cleanup()
          if (err) {
            // Ignore AbortError since we intentionally abort watches
            if (
              err instanceof Error &&
              (err.name === 'AbortError' || err.message.includes('aborted'))
            ) {
              return
            }
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
          const errorMsg =
            chartVersion && spec.kind === 'HelmRelease'
              ? `${ANSI_RED}ERROR ❌ ${spec.kind} '${spec.name}' did not become ready with chart version ${chartVersion} in namespace '${namespace}' within timeout${ANSI_RESET}`
              : `${ANSI_RED}ERROR ❌ ${spec.kind} '${spec.name}' is not ready in namespace '${namespace}' within timeout${ANSI_RESET}`
          reject(new Error(errorMsg))
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

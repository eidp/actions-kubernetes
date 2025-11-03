import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { KubernetesClient } from './kubernetes-client'
import {
  OCIRepository,
  Kustomization,
  FluxResourceSpec,
  FluxResource,
  DeploymentStatus
} from './types'
import { parseTimeout } from '@actions-kubernetes/shared/time-utils'
import {
  FLUXCD_NAMESPACE,
  ANSI_RED,
  ANSI_RESET
} from '@actions-kubernetes/shared/constants'
import { Labels } from '@actions-kubernetes/shared/labels'

// Watch retry configuration
const INITIAL_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 10000
const MAX_RETRIES = 5

/**
 * FluxCD-specific operations client
 */
export class FluxClient {
  private readonly kubeConfig: k8s.KubeConfig
  readonly k8sClient: KubernetesClient

  constructor(kubeConfig: k8s.KubeConfig) {
    this.kubeConfig = kubeConfig
    this.k8sClient = new KubernetesClient(kubeConfig)
  }

  /**
   * Create or update an OCIRepository
   */
  async createOCIRepository(
    ociRepository: OCIRepository,
    fieldManager: string = 'flux-client'
  ): Promise<void> {
    core.info(`Creating OCIRepository: ${ociRepository.metadata.name}`)
    await this.k8sClient.applyCustomObject(ociRepository, fieldManager)
  }

  /**
   * Create or update a Kustomization
   */
  async createKustomization(
    kustomization: Kustomization,
    fieldManager: string = 'flux-client'
  ): Promise<void> {
    core.info(`Deploying Kustomization: ${kustomization.metadata.name}`)
    await this.k8sClient.applyCustomObject(kustomization, fieldManager)
  }

  /**
   * List Kustomizations by label selector
   */
  async listKustomizations(labelSelector: string): Promise<Kustomization[]> {
    return (await this.k8sClient.listCustomResources(
      'kustomize.toolkit.fluxcd.io',
      'v1',
      FLUXCD_NAMESPACE,
      'kustomizations',
      labelSelector
    )) as Kustomization[]
  }

  /**
   * List OCIRepositories by label selector
   */
  async listOCIRepositories(labelSelector: string): Promise<OCIRepository[]> {
    return (await this.k8sClient.listCustomResources(
      'source.toolkit.fluxcd.io',
      'v1',
      FLUXCD_NAMESPACE,
      'ocirepositories',
      labelSelector
    )) as OCIRepository[]
  }

  /**
   * Find resources by label selector
   */
  async findResourcesByLabel(labelSelector: string): Promise<{
    kustomizations: Kustomization[]
    ociRepositories: OCIRepository[]
  }> {
    const [kustomizations, ociRepositories] = await Promise.all([
      this.listKustomizations(labelSelector),
      this.listOCIRepositories(labelSelector)
    ])

    return { kustomizations, ociRepositories }
  }

  /**
   * Delete a Kustomization
   */
  async deleteKustomization(
    name: string,
    dryRun: boolean = false
  ): Promise<void> {
    if (dryRun) return

    try {
      await this.k8sClient.deleteCustomResource(
        'kustomize.toolkit.fluxcd.io',
        'v1',
        FLUXCD_NAMESPACE,
        'kustomizations',
        name
      )
      core.info(`  ✅ Deleted Kustomization: ${name}`)
    } catch (error: unknown) {
      if (this.k8sClient.isNotFoundError(error)) {
        core.info(`  ℹ️ Kustomization ${name} already deleted`)
      } else {
        throw error
      }
    }
  }

  /**
   * Delete an OCIRepository
   */
  async deleteOCIRepository(
    name: string,
    dryRun: boolean = false
  ): Promise<void> {
    if (dryRun) return

    try {
      await this.k8sClient.deleteCustomResource(
        'source.toolkit.fluxcd.io',
        'v1',
        FLUXCD_NAMESPACE,
        'ocirepositories',
        name
      )
      core.info(`  ✅ Deleted OCIRepository: ${name}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)

      if (this.k8sClient.isNotFoundError(error)) {
        core.info(`  ℹ️ OCIRepository ${name} already deleted`)
      } else {
        core.warning(`Failed to delete OCIRepository ${name}: ${message}`)
      }
    }
  }

  /**
   * Find and delete matching OCIRepository by CI reference
   */
  async deleteMatchingOCIRepository(
    ciReferenceLabel: string,
    dryRun: boolean = false
  ): Promise<void> {
    if (dryRun) return

    try {
      const ociRepositories = await this.listOCIRepositories(
        `${Labels.PREVIEW_DEPLOYMENT}=true,${Labels.CI_REFERENCE}=${ciReferenceLabel}`
      )

      for (const oci of ociRepositories) {
        await this.deleteOCIRepository(oci.metadata.name, dryRun)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      core.warning(
        `Failed to find/delete matching OCIRepository for ci-reference ${ciReferenceLabel}: ${message}`
      )
    }
  }

  /**
   * Wait for resources to be deleted
   */
  async waitForDeletion(
    kustomizations: Kustomization[],
    ociRepositories: OCIRepository[],
    timeout: string
  ): Promise<void> {
    core.info('Waiting for resources to be fully deleted...')

    const timeoutMs = parseTimeout(timeout)
    const startTime = Date.now()

    for (const kust of kustomizations) {
      await this.waitForKustomizationDeletion(kust.metadata.name, timeout)
      if (Date.now() - startTime > timeoutMs) {
        core.warning('Timeout reached while waiting for deletion')
        return
      }
    }

    for (const oci of ociRepositories) {
      await this.waitForOCIRepositoryDeletion(oci.metadata.name, timeout)
      if (Date.now() - startTime > timeoutMs) {
        core.warning('Timeout reached while waiting for deletion')
        return
      }
    }

    core.info('✅ Resources deleted successfully')
  }

  /**
   * Wait for Kustomization deletion
   */
  async waitForKustomizationDeletion(
    name: string,
    timeout: string
  ): Promise<void> {
    const timeoutMs = parseTimeout(timeout)
    const startTime = Date.now()
    const pollInterval = 2000

    while (Date.now() - startTime < timeoutMs) {
      try {
        await this.k8sClient.getCustomResource(
          'kustomize.toolkit.fluxcd.io',
          'v1',
          FLUXCD_NAMESPACE,
          'kustomizations',
          name
        )
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      } catch (error: unknown) {
        if (this.k8sClient.isNotFoundError(error)) {
          return
        }
        throw error
      }
    }
  }

  /**
   * Wait for OCIRepository deletion
   */
  async waitForOCIRepositoryDeletion(
    name: string,
    timeout: string
  ): Promise<void> {
    const timeoutMs = parseTimeout(timeout)
    const startTime = Date.now()
    const pollInterval = 2000

    while (Date.now() - startTime < timeoutMs) {
      try {
        await this.k8sClient.getCustomResource(
          'source.toolkit.fluxcd.io',
          'v1',
          FLUXCD_NAMESPACE,
          'ocirepositories',
          name
        )
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      } catch (error: unknown) {
        if (this.k8sClient.isNotFoundError(error)) {
          return
        }
        throw error
      }
    }
  }

  /**
   * Parse FluxCD resource input string (e.g., "helmreleases/my-release")
   */
  parseFluxResourceInput(fluxResource: string): FluxResourceSpec {
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

  /**
   * Wait for flux resource to become ready
   */
  async waitForResourceReady(
    namespace: string,
    spec: FluxResourceSpec,
    timeout: number,
    chartVersion?: string
  ): Promise<DeploymentStatus> {
    // Helper function to check if resource meets all criteria
    const isResourceFullyReady = (resource: FluxResource): boolean => {
      if (!this.isResourceReady(resource)) {
        return false
      }

      // If chartVersion specified and this is a HelmRelease, check version
      if (chartVersion && spec.kind === 'HelmRelease') {
        const deployedVersion = this.getChartVersionFromResource(resource)
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

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
        if (watchRequest) {
          watchRequest.abort()
        }
      }

      const startWatch = () => {
        const watch = new k8s.Watch(this.kubeConfig)
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
                    resolve(this.createDeploymentStatus(resource))
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
                if (elapsed < timeout && retryCount < MAX_RETRIES) {
                  retryCount++
                  const retryDelay = Math.min(
                    INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1),
                    MAX_RETRY_DELAY_MS
                  )
                  core.info(
                    `Watch connection closed (${err instanceof Error ? err.message : String(err)}), retrying in ${retryDelay}ms (attempt ${retryCount}/${MAX_RETRIES})...`
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
            if (elapsed < timeout && retryCount < MAX_RETRIES) {
              retryCount++
              const retryDelay = Math.min(
                INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1),
                MAX_RETRY_DELAY_MS
              )
              core.info(
                `Failed to start watch (${err instanceof Error ? err.message : String(err)}), retrying in ${retryDelay}ms (attempt ${retryCount}/${MAX_RETRIES})...`
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

  /**
   * Check if a FluxCD resource is ready
   */
  isResourceReady(resource: FluxResource): boolean {
    if (!resource.status?.conditions) {
      return false
    }

    const readyCondition = resource.status.conditions.find(
      (c: { type: string; status: string }) => c.type === 'Ready'
    )

    return readyCondition?.status === 'True'
  }

  /**
   * Get chart version from HelmRelease resource
   */
  getChartVersionFromResource(resource: FluxResource): string | undefined {
    if (resource.kind === 'HelmRelease' && resource.status) {
      return (resource.status as { lastAppliedRevision?: string })
        .lastAppliedRevision
    }
    return undefined
  }

  /**
   * Create deployment status from resource
   */
  createDeploymentStatus(resource: FluxResource): DeploymentStatus {
    return {
      ready: this.isResourceReady(resource),
      resource,
      chartVersion: this.getChartVersionFromResource(resource)
    }
  }
}

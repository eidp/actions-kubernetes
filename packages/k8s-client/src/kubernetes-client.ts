import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { ConfigMap, KubernetesResource } from './types.js'

/**
 * Generic Kubernetes operations client
 */
export class KubernetesClient {
  private readonly kubeConfig: k8s.KubeConfig
  private coreApi?: k8s.CoreV1Api
  private customApi?: k8s.CustomObjectsApi
  private objectApi?: k8s.KubernetesObjectApi

  constructor(kubeConfig: k8s.KubeConfig) {
    this.kubeConfig = kubeConfig
  }

  private getCoreApi(): k8s.CoreV1Api {
    if (!this.coreApi) {
      this.coreApi = this.kubeConfig.makeApiClient(k8s.CoreV1Api)
    }
    return this.coreApi
  }

  private getCustomApi(): k8s.CustomObjectsApi {
    if (!this.customApi) {
      this.customApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi)
    }
    return this.customApi
  }

  private getObjectApi(): k8s.KubernetesObjectApi {
    if (!this.objectApi) {
      this.objectApi = k8s.KubernetesObjectApi.makeApiClient(this.kubeConfig)
    }
    return this.objectApi
  }

  /**
   * Read a ConfigMap from a namespace
   */
  async readConfigMap(name: string, namespace: string): Promise<ConfigMap> {
    try {
      const response = await this.getCoreApi().readNamespacedConfigMap({
        name,
        namespace
      })
      return response as ConfigMap
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to read ConfigMap '${name}' from namespace '${namespace}': ${error.message}`
        )
      }
      throw error
    }
  }

  /**
   * Apply a custom resource using Server-Side Apply
   */
  async applyCustomObject(
    resource: KubernetesResource,
    fieldManager: string
  ): Promise<void> {
    const client = this.getObjectApi()

    await client.patch(
      resource as k8s.KubernetesObject,
      undefined, // pretty
      undefined, // dryRun
      fieldManager, // identifies the action
      true, // force (take ownership of conflicting fields)
      k8s.PatchStrategy.ServerSideApply
    )

    core.info(
      `✅ ${resource.kind} '${resource.metadata.name}' applied successfully`
    )
  }

  /**
   * List custom resources by label selector
   */
  async listCustomResources(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    labelSelector: string
  ): Promise<KubernetesResource[]> {
    const response = (await this.getCustomApi().listNamespacedCustomObject({
      group,
      version,
      namespace,
      plural,
      labelSelector
    })) as { items: KubernetesResource[] }

    return response.items
  }

  /**
   * Get a custom resource
   */
  async getCustomResource(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string
  ): Promise<KubernetesResource> {
    return (await this.getCustomApi().getNamespacedCustomObject({
      group,
      version,
      namespace,
      plural,
      name
    })) as KubernetesResource
  }

  /**
   * Delete a custom resource
   */
  async deleteCustomResource(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string,
    propagationPolicy: 'Background' | 'Foreground' | 'Orphan' = 'Background'
  ): Promise<void> {
    await this.getCustomApi().deleteNamespacedCustomObject({
      group,
      version,
      namespace,
      plural,
      name,
      propagationPolicy
    })
  }

  /**
   * Check if an error is a 404 Not Found error
   */
  isNotFoundError(error: unknown): boolean {
    const hasCode = error instanceof Error && 'code' in error
    const code = hasCode ? (error as { code: number }).code : null
    return code === 404
  }

  /**
   * Discover application URL from Ingress resources
   */
  async discoverIngressURL(
    namespace: string,
    labelSelector?: string
  ): Promise<string | undefined> {
    try {
      const networkingApi = this.kubeConfig.makeApiClient(k8s.NetworkingV1Api)
      const ingresses = await networkingApi.listNamespacedIngress({
        namespace,
        labelSelector
      })

      if (ingresses.items.length === 0) {
        core.info(
          `No ingress resources found in namespace ${namespace}${labelSelector ? ` with selector: ${labelSelector}` : ''}`
        )
        return undefined
      }

      if (ingresses.items.length > 1 && !labelSelector) {
        core.warning(
          `Found ${ingresses.items.length} ingress resources in namespace ${namespace}. ` +
            `Consider using a label selector to choose a specific ingress.`
        )
        core.info(`Using first ingress: ${ingresses.items[0].metadata?.name}`)
      } else {
        core.info(
          `Found ${ingresses.items.length} ingress(es) in namespace ${namespace}`
        )
        if (labelSelector) {
          core.info(`Label selector used: ${labelSelector}`)
        }
      }

      const ingress = ingresses.items[0]
      const host = ingress.spec?.rules?.[0]?.host

      if (!host) {
        core.warning(
          `Ingress '${ingress.metadata?.name}' found but no host configured`
        )
        return undefined
      }

      const hasTls = ingress.spec?.tls && ingress.spec.tls.length > 0
      const url = hasTls ? `https://${host}` : `http://${host}`
      core.info(`✅ Application URL discovered: ${url}`)
      return url
    } catch (error) {
      core.warning(
        `Failed to discover application URL: ${error instanceof Error ? error.message : String(error)}`
      )
      return undefined
    }
  }
}

/**
 * Base Kubernetes resource interface
 */
export interface KubernetesResource {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    creationTimestamp?: string
  }
}

/**
 * OCIRepository spec from source.toolkit.fluxcd.io/v1
 */
export interface OCIRepositorySpec {
  interval: string
  url: string
  ref: {
    tag: string
  }
  secretRef?: {
    name: string
  }
}

/**
 * OCIRepository resource from FluxCD
 */
export interface OCIRepository extends KubernetesResource {
  apiVersion: 'source.toolkit.fluxcd.io/v1'
  kind: 'OCIRepository'
  spec: OCIRepositorySpec
}

/**
 * Kustomization spec from kustomize.toolkit.fluxcd.io/v1
 */
export interface KustomizationSpec {
  serviceAccountName: string
  interval: string
  sourceRef: {
    kind: string
    name: string
  }
  path: string
  prune: boolean
  wait: boolean
  timeout: string
  postBuild?: {
    substitute?: Record<string, string>
  }
}

/**
 * Kustomization resource from FluxCD
 */
export interface Kustomization extends KubernetesResource {
  apiVersion: 'kustomize.toolkit.fluxcd.io/v1'
  kind: 'Kustomization'
  spec: KustomizationSpec
}

/**
 * FluxCD resource specification for API operations
 */
export interface FluxResourceSpec {
  group: string
  version: string
  plural: string
  kind: string
  name: string
}

/**
 * Generic FluxCD resource with status
 */
export interface FluxResource extends KubernetesResource {
  status?: {
    conditions?: Array<{
      type: string
      status: string
      reason?: string
      message?: string
    }>
    [key: string]: unknown
  }
}

/**
 * Deployment status returned from verification
 */
export interface DeploymentStatus {
  ready: boolean
  resource: FluxResource
  chartVersion?: string
}

/**
 * ConfigMap data structure
 */
export interface ConfigMap {
  data?: Record<string, string>
  [key: string]: unknown
}

export interface FluxCondition {
  type: string
  status: 'True' | 'False' | 'Unknown'
  message?: string
  reason?: string
  lastTransitionTime?: string
}

export interface HelmReleaseHistory {
  chartVersion: string
}

export interface HelmReleaseStatus {
  conditions?: FluxCondition[]
  history?: HelmReleaseHistory[]
}

export interface HelmRelease {
  apiVersion: 'helm.toolkit.fluxcd.io/v2'
  kind: 'HelmRelease'
  metadata: {
    name: string
    namespace: string
  }
  status?: HelmReleaseStatus
}

export interface KustomizationStatus {
  conditions?: FluxCondition[]
}

export interface Kustomization {
  apiVersion: 'kustomize.toolkit.fluxcd.io/v1'
  kind: 'Kustomization'
  metadata: {
    name: string
    namespace: string
  }
  status?: KustomizationStatus
}

export type FluxResource = HelmRelease | Kustomization

export interface FluxResourceSpec {
  group: string
  version: string
  plural: string
  name: string
  kind: string
}

export interface DeploymentStatus {
  name: string
  type: string
  ready: string
  message: string
}

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

export interface OCIRepository {
  apiVersion: 'source.toolkit.fluxcd.io/v1'
  kind: 'OCIRepository'
  metadata: {
    name: string
    namespace: string
    labels: Record<string, string>
  }
  spec: OCIRepositorySpec
}

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

export interface Kustomization {
  apiVersion: 'kustomize.toolkit.fluxcd.io/v1'
  kind: 'Kustomization'
  metadata: {
    name: string
    namespace: string
    labels: Record<string, string>
  }
  spec: KustomizationSpec
}

export interface KubernetesResource {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace: string
    creationTimestamp: string
    labels: Record<string, string>
  }
}

export interface Kustomization extends KubernetesResource {
  apiVersion: 'kustomize.toolkit.fluxcd.io/v1'
  kind: 'Kustomization'
}

export interface OCIRepository extends KubernetesResource {
  apiVersion: 'source.toolkit.fluxcd.io/v1'
  kind: 'OCIRepository'
}

export interface DeletedResource {
  type: 'Kustomization' | 'OCIRepository'
  name: string
  age?: string
  reference?: string
}

export interface SkippedResource {
  name: string
  reason: string
  age?: string
}

export interface ActionInputs {
  kubernetesContext: string
  reference: string
  ciPrefixLength: number
  waitForDeletion: boolean
  timeout: string
  dryRun: boolean
  maxAge: string
}

export interface ActionOutputs {
  deletedCount: number
  deletedResources: DeletedResource[]
  skippedCount: number
  skippedResources: SkippedResource[]
}

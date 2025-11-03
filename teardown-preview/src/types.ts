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

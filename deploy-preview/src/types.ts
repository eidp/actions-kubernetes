export interface ActionInputs {
  githubToken: string
  environment: string
  kubernetesContext: string
  tenantName: string
  reference: string
  ciPrefixLength: number
  chartVersion: string
  timeout: string
}

export interface ResourceNames {
  ciPrefix: string
  ociRepoName: string
  kustomizationName: string
  namespace: string
}

export interface SlashCommandResult {
  shouldExecute: boolean
  commentId: number | null
}

export interface DeploymentSummaryData {
  tenantName: string
  ciPrefix: string
  namespace: string
  ociRepoName: string
  kustomizationName: string
  gitBranch: string
}

export interface TenantsReplacementConfig {
  instanceName: string
  clusterName: string
  objectStoreEndpoint: string
}

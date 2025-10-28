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

export interface KustomizationResource {
  apiVersion: 'kustomize.toolkit.fluxcd.io/v1'
  kind: 'Kustomization'
  metadata: {
    name: string
    namespace: string
  }
  status?: KustomizationStatus
}

export type FluxResource = HelmRelease | KustomizationResource

export interface DeploymentStatus {
  name: string
  type: string
  ready: string
  message: string
}

export function isResourceReady(resource: FluxResource): boolean {
  const conditions = resource.status?.conditions || []
  const readyCondition = conditions.find((c) => c.type === 'Ready')
  return readyCondition?.status === 'True'
}

export function getReadyMessage(resource: FluxResource): string {
  const conditions = resource.status?.conditions || []
  const readyCondition = conditions.find((c) => c.type === 'Ready')
  return (
    readyCondition?.message ||
    (readyCondition?.status === 'True' ? 'Ready' : 'Not Ready')
  )
}

export function createDeploymentStatus(
  resource: FluxResource
): DeploymentStatus {
  return {
    name: resource.metadata.name,
    type: resource.kind,
    ready: isResourceReady(resource) ? 'True' : 'False',
    message: getReadyMessage(resource)
  }
}

export function getChartVersion(helmRelease: HelmRelease): string | undefined {
  return helmRelease.status?.history?.[0]?.chartVersion
}

export function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)([smh])$/)
  if (!match) {
    throw new Error(
      `Invalid timeout format: ${timeout}. Expected format: <number><unit> (e.g., 3m, 180s)`
    )
  }

  const value = parseInt(match[1], 10)
  const unit = match[2] as 's' | 'm' | 'h'

  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000 }
  return value * multipliers[unit]
}

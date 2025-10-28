import type { FluxResource, HelmRelease, DeploymentStatus } from './types'

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

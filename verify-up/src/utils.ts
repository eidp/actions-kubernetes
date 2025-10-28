import type { FluxResource, HelmRelease, DeploymentStatus } from './types'
import parse from 'parse-duration'

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

export function parseDuration(duration: string): number {
  const result = parse(duration)

  if (result === null || result === undefined) {
    throw new Error(
      `Invalid duration format: ${duration}. Expected format: duration string (e.g., 3m, 180s, 1h30m, 7h3m45s)`
    )
  }

  if (result < 0) {
    throw new Error(
      `Invalid duration: ${duration}. Duration cannot be negative`
    )
  }

  return result
}

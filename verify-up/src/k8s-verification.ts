import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import {
  FluxClient,
  KubernetesClient,
  DeploymentStatus
} from '@actions-kubernetes/k8s-client'
import { parseDuration } from '@actions-kubernetes/shared/time-utils'
import { ResourceVerificationResult } from './types'

export async function verifySpecificResource(
  kc: k8s.KubeConfig,
  namespace: string,
  fluxResource: string,
  chartVersion: string | undefined,
  timeoutStr: string
): Promise<ResourceVerificationResult[]> {
  const timeout = parseDuration(timeoutStr)
  const fluxClient = new FluxClient(kc)
  const spec = fluxClient.parseFluxResourceInput(fluxResource)

  core.startGroup(
    `Verifying Flux resource '${fluxResource}' in namespace '${namespace}'`
  )

  // Wait for resource to be ready (and have correct version if specified)
  const result: DeploymentStatus = await fluxClient.waitForResourceReady(
    namespace,
    spec,
    timeout,
    chartVersion
  )

  // Convert to display format
  const ready = fluxClient.isResourceReady(result.resource)
  const readyCondition = result.resource.status?.conditions?.find(
    (c: { type: string; status: string; message?: string }) =>
      c.type === 'Ready'
  )
  const message =
    readyCondition?.message ||
    (readyCondition?.status === 'True' ? 'Ready' : 'Not Ready')

  const verificationResult: ResourceVerificationResult = {
    name: result.resource.metadata.name,
    type: result.resource.kind,
    ready: ready ? 'True' : 'False',
    message
  }

  core.endGroup()
  return [verificationResult]
}

export async function discoverURL(
  kc: k8s.KubeConfig,
  namespace: string,
  ingressSelector: string
): Promise<string> {
  core.startGroup('Discovering application URL')

  const k8sClient = new KubernetesClient(kc)
  const url = await k8sClient.discoverIngressURL(namespace, ingressSelector)

  if (!url) {
    core.info('Deployment is ready but no URL is available')
  }

  core.endGroup()
  return url || ''
}

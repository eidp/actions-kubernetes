import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { parseFluxResourceInput, waitForResourceReady } from './flux-resources'
import { DeploymentStatus } from './types'
import { parseDuration } from './utils'

export async function verifySpecificResource(
  kc: k8s.KubeConfig,
  namespace: string,
  fluxResource: string,
  chartVersion: string | undefined,
  timeoutStr: string
): Promise<DeploymentStatus[]> {
  const timeout = parseDuration(timeoutStr)
  const spec = parseFluxResourceInput(fluxResource)

  core.startGroup(
    `Verifying Flux resource '${fluxResource}' in namespace '${namespace}'`
  )

  // Wait for resource to be ready (and have correct version if specified)
  const status = await waitForResourceReady(
    kc,
    namespace,
    spec,
    timeout,
    chartVersion
  )

  core.endGroup()
  return [status]
}

export async function discoverURL(
  kc: k8s.KubeConfig,
  namespace: string,
  ingressSelector: string
): Promise<string> {
  core.startGroup('Discovering application URL')

  let url = ''

  try {
    const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api)
    const ingresses = await networkingApi.listNamespacedIngress({
      namespace,
      labelSelector: ingressSelector
    })

    if (ingresses.items.length === 0) {
      core.info(
        `No ingress resources found in namespace ${namespace}${ingressSelector ? ` with selector: ${ingressSelector}` : ''}`
      )
      core.info('Deployment is ready but no URL is available')
    } else if (ingresses.items.length > 1 && !ingressSelector) {
      core.warning(
        `Found ${ingresses.items.length} ingress resources in namespace ${namespace}. ` +
          `Consider using 'ingress-selector' input to choose a specific ingress.`
      )
      core.info(`Using first ingress: ${ingresses.items[0].metadata?.name}`)

      const ingress = ingresses.items[0]
      const host = ingress.spec?.rules?.[0]?.host

      if (host) {
        const hasTls = ingress.spec?.tls && ingress.spec.tls.length > 0
        url = hasTls ? `https://${host}` : `http://${host}`
        core.info(`✅ Application URL discovered: ${url}`)
      } else {
        core.warning(
          `Ingress '${ingress.metadata?.name}' found but no host configured`
        )
      }
    } else {
      core.info(
        `Found ${ingresses.items.length} ingress(es) in namespace ${namespace}`
      )
      if (ingressSelector) {
        core.info(`Label selector used: ${ingressSelector}`)
      }

      const ingress = ingresses.items[0]
      const host = ingress.spec?.rules?.[0]?.host

      if (host) {
        const hasTls = ingress.spec?.tls && ingress.spec.tls.length > 0
        url = hasTls ? `https://${host}` : `http://${host}`
        core.info(`✅ Application URL discovered: ${url}`)
      } else {
        core.warning(
          `Ingress '${ingress.metadata?.name}' found but no host configured`
        )
      }
    }
  } catch (error) {
    core.warning(
      `Failed to discover application URL: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  core.endGroup()
  return url
}

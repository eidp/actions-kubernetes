import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import {
  parseFluxResourceInput,
  waitForResourceReady,
  listAndWatchAllResources
} from './flux-resources'
import { DeploymentStatus, HelmRelease } from './types'
import { getChartVersion, parseDuration } from './utils'
import { ANSI_RED, ANSI_RESET } from '../../shared/src/constants'

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

  // Wait for resource to be ready
  const status = await waitForResourceReady(kc, namespace, spec, timeout)

  // If chart version specified, verify it matches
  if (chartVersion && spec.kind === 'HelmRelease') {
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
    const helmRelease = (await customApi.getNamespacedCustomObject({
      group: spec.group,
      version: spec.version,
      namespace: namespace,
      plural: spec.plural,
      name: spec.name
    })) as HelmRelease

    const deployedVersion = getChartVersion(helmRelease)

    if (deployedVersion !== chartVersion) {
      core.error(
        `${ANSI_RED}ERROR ❌ Deployed Helm Chart has version: ${deployedVersion}, expected version: ${chartVersion}${ANSI_RESET}`
      )
      throw new Error(
        `Version mismatch: deployed ${deployedVersion}, expected ${chartVersion}`
      )
    }

    core.info(
      `✅ Helm Chart with version: '${chartVersion}' is deployed in Flux resource '${fluxResource}'`
    )
  }

  core.endGroup()
  return [status]
}

export async function verifyAllResources(
  kc: k8s.KubeConfig,
  namespace: string,
  chartVersion: string | undefined,
  timeoutStr: string
): Promise<DeploymentStatus[]> {
  const timeout = parseDuration(timeoutStr)

  core.startGroup(
    `Verifying whether flux resources in namespace '${namespace}'`
  )

  // Wait for all resources to be ready
  const statuses = await listAndWatchAllResources(kc, namespace, timeout)

  if (statuses.length === 0) {
    core.endGroup()
    return []
  }

  // If chart version specified, verify at least one HelmRelease has it
  if (chartVersion) {
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi)
    const helmReleases = (await customApi.listNamespacedCustomObject({
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      namespace: namespace,
      plural: 'helmreleases'
    })) as { items: HelmRelease[] }

    if (helmReleases.items.length === 0) {
      core.warning(`No HelmReleases found in namespace '${namespace}'`)
    } else {
      core.info(`Verifying chart version '${chartVersion}' is deployed...`)
      let versionFound = false

      for (const hr of helmReleases.items) {
        const deployedVersion = getChartVersion(hr)
        const hrName = hr.metadata.name

        if (deployedVersion === chartVersion) {
          core.info(
            `✅ HelmRelease '${hrName}' has chart version: ${deployedVersion}`
          )
          versionFound = true
        } else {
          core.info(
            `⚠️ HelmRelease '${hrName}' has chart version: ${deployedVersion} (expected: ${chartVersion})`
          )
        }
      }

      if (!versionFound) {
        core.error(
          `${ANSI_RED}ERROR ❌ No HelmRelease found with chart version '${chartVersion}' in namespace '${namespace}'${ANSI_RESET}`
        )
        throw new Error(
          `No HelmRelease found with chart version '${chartVersion}' in namespace '${namespace}'`
        )
      }
    }
  }

  core.endGroup()
  return statuses
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

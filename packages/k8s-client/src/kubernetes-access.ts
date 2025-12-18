import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { FLUXCD_NAMESPACE } from './constants.js'

export interface VerifyKubernetesAccessOptions {
  requireFluxPermissions?: boolean
}

const defaultOptions: VerifyKubernetesAccessOptions = {
  requireFluxPermissions: true
}

export async function verifyKubernetesAccess(
  kubernetesContext: string,
  options: VerifyKubernetesAccessOptions = {}
): Promise<k8s.KubeConfig> {
  const opts = { ...defaultOptions, ...options }
  core.startGroup('Verifying Kubernetes connectivity')

  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()

  const contexts = kc.getContexts()
  const contextExists = contexts.some((ctx) => ctx.name === kubernetesContext)

  if (!contextExists) {
    core.error(
      `Cannot find context '${kubernetesContext}' in kubeconfig. Available contexts:`
    )
    contexts.forEach((ctx) => core.info(`  - ${ctx.name}`))
    throw new Error(`Context '${kubernetesContext}' does not exist`)
  }

  kc.setCurrentContext(kubernetesContext)
  core.info(`Using context: ${kubernetesContext}`)

  // Verify authentication (equivalent to kubectl auth whoami)
  const authApi = kc.makeApiClient(k8s.AuthenticationV1Api)
  try {
    const whoami = await authApi.createSelfSubjectReview({
      body: {
        apiVersion: 'authentication.k8s.io/v1',
        kind: 'SelfSubjectReview'
      }
    })
    const username = whoami.status?.userInfo?.username || 'authenticated user'
    core.info(`✅ Successfully authenticated as: ${username}`)
  } catch (error) {
    throw new Error(
      `Cannot connect to the cluster using context '${kubernetesContext}': ${error}`
    )
  }

  // Check FluxCD permissions
  if (opts.requireFluxPermissions) {
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

    try {
      await customApi.listNamespacedCustomObject({
        group: 'source.toolkit.fluxcd.io',
        version: 'v1',
        namespace: FLUXCD_NAMESPACE,
        plural: 'ocirepositories',
        limit: 1
      })
      core.info(`✅ Can list OCIRepository resources in ${FLUXCD_NAMESPACE}`)
    } catch (error: unknown) {
      const hasStatusCode = error instanceof Error && 'statusCode' in error
      const statusCode = hasStatusCode
        ? (error as { statusCode: number }).statusCode
        : null

      if (statusCode === 403) {
        throw new Error(
          `Insufficient permissions to list OCIRepository resources in namespace ${FLUXCD_NAMESPACE}`
        )
      }
      throw error
    }

    try {
      await customApi.listNamespacedCustomObject({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        namespace: FLUXCD_NAMESPACE,
        plural: 'kustomizations',
        limit: 1
      })
      core.info(`✅ Can list Kustomization resources in ${FLUXCD_NAMESPACE}`)
    } catch (error: unknown) {
      const hasStatusCode = error instanceof Error && 'statusCode' in error
      const statusCode = hasStatusCode
        ? (error as { statusCode: number }).statusCode
        : null

      if (statusCode === 403) {
        throw new Error(
          `Insufficient permissions to list Kustomization resources in namespace ${FLUXCD_NAMESPACE}`
        )
      }
      throw error
    }
  }

  core.info('✅ Successfully connected to cluster with required permissions')
  core.endGroup()

  return kc
}

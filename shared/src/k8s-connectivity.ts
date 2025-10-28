import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'

export interface ConnectivityOptions {
  checkNamespace?: string
  checkPermissions?: boolean
}

export async function verifyKubernetesConnectivity(
  kubernetesContext: string,
  options?: ConnectivityOptions
): Promise<k8s.KubeConfig> {
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

  const coreV1Api = kc.makeApiClient(k8s.CoreV1Api)

  if (options?.checkNamespace) {
    try {
      await coreV1Api.readNamespace({ name: options.checkNamespace })
      core.info(`✅ Namespace '${options.checkNamespace}' exists`)
    } catch {
      core.error(`❌ Namespace '${options.checkNamespace}' does not exist`)
      const namespaces = await coreV1Api.listNamespace()
      core.info('Available namespaces:')
      namespaces.items.forEach((ns) =>
        core.info(`  - ${ns.metadata?.name || 'unknown'}`)
      )
      throw new Error(`Namespace '${options.checkNamespace}' does not exist`)
    }
  }

  if (options?.checkPermissions && options?.checkNamespace) {
    const authApi = kc.makeApiClient(k8s.AuthorizationV1Api)
    try {
      const review = await authApi.createSelfSubjectAccessReview({
        body: {
          apiVersion: 'authorization.k8s.io/v1',
          kind: 'SelfSubjectAccessReview',
          spec: {
            resourceAttributes: {
              namespace: options.checkNamespace,
              verb: 'get',
              resource: 'pods'
            }
          }
        }
      })

      if (!review.status?.allowed) {
        core.startGroup('Current Permissions')
        const accessReview = await authApi.createSelfSubjectRulesReview({
          body: {
            apiVersion: 'authorization.k8s.io/v1',
            kind: 'SelfSubjectRulesReview',
            spec: {
              namespace: options.checkNamespace
            }
          }
        })
        core.info(JSON.stringify(accessReview.status, null, 2))
        core.endGroup()
        throw new Error(
          `❌ Insufficient permissions to access pods in namespace '${options.checkNamespace}'`
        )
      }
      core.info(
        `✅ Sufficient permissions to access pods in namespace '${options.checkNamespace}'`
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Insufficient permissions')
      ) {
        throw error
      }
      throw new Error(`Failed to check permissions: ${error}`)
    }
  }

  core.endGroup()
  return kc
}

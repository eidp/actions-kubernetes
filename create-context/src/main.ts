import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import * as path from 'path'
import { parseJWTClaims } from './jwt'
import { exchangeToken } from './token-exchange'

async function run(): Promise<void> {
  try {
    // Get inputs
    const cluster = core.getInput('cluster') || 'development'
    const apiServer = core.getInput('api-server', { required: true })
    const certificateAuthorityData = core.getInput(
      'certificate-authority-data',
      {
        required: true
      }
    )
    const printJwtClaims = core.getBooleanInput('print-jwt-claims')
    const keycloakUrl = core.getInput('keycloak-url', {
      required: true
    })
    const tokenExchangeClientId = core.getInput('token-exchange-client-id', {
      required: true
    })
    const tokenExchangeClientSecret = core.getInput(
      'token-exchange-client-secret',
      { required: true }
    )

    // Validate inputs
    if (!apiServer.startsWith('https://')) {
      throw new Error('api-server must be an https:// URL')
    }

    const clusterNameRegex = /^[a-zA-Z0-9-]+$/
    if (!clusterNameRegex.test(cluster)) {
      throw new Error(
        'cluster must contain only alphanumeric characters and hyphens'
      )
    }

    // Validate certificate-authority-data is valid base64
    try {
      Buffer.from(certificateAuthorityData, 'base64')
    } catch {
      throw new Error('certificate-authority-data is not valid base64')
    }

    // Get GitHub OIDC token
    core.startGroup('Obtain GitHub OIDC token')
    core.info('Requesting GitHub OIDC token with audience: kubernetes')
    const githubToken = await core.getIDToken('kubernetes')
    core.setSecret(githubToken)

    if (printJwtClaims) {
      try {
        const claims = parseJWTClaims(githubToken)
        core.info('')
        core.info('GitHub OIDC token claims:')
        core.info(JSON.stringify(claims, null, 2))
      } catch (error) {
        core.warning(`Failed to parse JWT claims: ${error}`)
      }
    }
    core.endGroup()

    // Exchange token with Keycloak
    core.startGroup('Exchange token with Keycloak')
    core.info(`Exchanging token at: ${keycloakUrl}`)
    const accessToken = await exchangeToken({
      endpoint: keycloakUrl,
      clientId: tokenExchangeClientId,
      clientSecret: tokenExchangeClientSecret,
      subjectToken: githubToken
    })
    core.setSecret(accessToken)

    if (printJwtClaims) {
      try {
        const claims = parseJWTClaims(accessToken)
        core.info('')
        core.info('Keycloak access token claims:')
        core.info(JSON.stringify(claims, null, 2))
      } catch (error) {
        core.warning(`Failed to parse JWT claims: ${error}`)
      }
    }
    core.endGroup()

    // Create Kubernetes configuration
    core.startGroup(`Creating kubernetes context for cluster '${cluster}'`)

    const kc = new k8s.KubeConfig()

    // Create cluster configuration
    const clusterConfig: k8s.Cluster = {
      name: cluster,
      server: apiServer,
      caData: certificateAuthorityData,
      skipTLSVerify: false
    }

    // Create user configuration
    const user: k8s.User = {
      name: 'github-actions',
      token: accessToken
    }

    // Create context configuration
    const context: k8s.Context = {
      name: cluster,
      cluster: cluster,
      user: 'github-actions'
    }

    // Add to kubeconfig
    core.info('Building kubeconfig...')
    kc.loadFromClusterAndUser(clusterConfig, user)
    kc.addContext(context)
    kc.setCurrentContext(cluster)

    // Export kubeconfig to default location
    const kubeConfigPath =
      process.env.KUBECONFIG || `${process.env.HOME}/.kube/config`
    core.info(`Writing kubeconfig to: ${kubeConfigPath}`)

    // Ensure .kube directory exists
    const kubeDir = path.dirname(kubeConfigPath)
    if (!fs.existsSync(kubeDir)) {
      fs.mkdirSync(kubeDir, { recursive: true })
    }

    // Write kubeconfig
    fs.writeFileSync(kubeConfigPath, kc.exportConfig(), 'utf8')

    core.endGroup()

    // Set output
    core.setOutput('context-name', cluster)

    // Generate summary
    core.startGroup('Generating GitHub summary')
    await core.summary
      .addHeading('✅ Kubernetes context created', 2)
      .addHeading('Context details', 3)
      .addEOL()
      .addRaw(`- **Context name**: \`${cluster}\`\n`)
      .addRaw(`- **API server**: \`${apiServer}\`\n`)
      .addRaw(`- **Cluster name**: \`${cluster}\`\n`)
      .addRaw(
        `\n---\n*Creation timestamp: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC*`
      )
      .write()
    core.endGroup()

    core.info('✅ Kubernetes context created successfully')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()

import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs'
import * as path from 'path'
import { parseJWTClaims } from './jwt'

async function run(): Promise<void> {
  try {
    // Get inputs
    const environment = core.getInput('environment') || 'development'
    const apiServer = core.getInput('api-server', { required: true })
    const certificateAuthorityData = core.getInput(
      'certificate-authority-data',
      {
        required: true
      }
    )
    const printJwtClaims = core.getBooleanInput('print-jwt-claims')

    // Validate inputs
    if (!apiServer.startsWith('https://')) {
      throw new Error('api-server must be an https:// URL')
    }

    if (!/^[a-zA-Z0-9-]+$/.test(environment)) {
      throw new Error(
        'environment must contain only alphanumeric characters and hyphens'
      )
    }

    // Validate certificate-authority-data is valid base64
    try {
      Buffer.from(certificateAuthorityData, 'base64')
    } catch {
      throw new Error('certificate-authority-data is not valid base64')
    }

    // Get OIDC token
    core.startGroup('Create GitHub OIDC token')
    core.info('Requesting GitHub OIDC token with audience: kubernetes')
    const idToken = await core.getIDToken('kubernetes')
    core.setSecret(idToken)

    if (printJwtClaims) {
      try {
        const claims = parseJWTClaims(idToken)
        core.info('')
        core.info('JWT Claims:')
        core.info(JSON.stringify(claims, null, 2))
      } catch (error) {
        core.warning(`Failed to parse JWT claims: ${error}`)
      }
    }
    core.endGroup()

    // Create Kubernetes configuration
    core.startGroup(
      `Creating kubernetes context for environment '${environment}'`
    )

    const kc = new k8s.KubeConfig()

    // Create cluster configuration
    const cluster: k8s.Cluster = {
      name: environment,
      server: apiServer,
      caData: certificateAuthorityData,
      skipTLSVerify: false
    }

    // Create user configuration
    const user: k8s.User = {
      name: 'github-actions',
      token: idToken
    }

    // Create context configuration
    const context: k8s.Context = {
      name: environment,
      cluster: environment,
      user: 'github-actions'
    }

    // Add to kubeconfig
    core.info('Building kubeconfig...')
    kc.loadFromClusterAndUser(cluster, user)
    kc.addContext(context)
    kc.setCurrentContext(environment)

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
    core.setOutput('context-name', environment)

    // Generate summary
    core.startGroup('Generating GitHub summary')
    await core.summary
      .addHeading('Kubernetes context created', 2)
      .addTable([
        [{ data: 'Context Name', header: true }, { data: environment }],
        [{ data: 'API Server', header: true }, { data: apiServer }],
        [{ data: 'Cluster Name', header: true }, { data: environment }]
      ])
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

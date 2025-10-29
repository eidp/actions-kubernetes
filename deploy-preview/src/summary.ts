import * as core from '@actions/core'

export async function generateDeploymentSummary(data: {
  tenantName: string
  ciPrefix: string
  namespace: string
  ociRepoName: string
  kustomizationName: string
  gitBranch: string
}): Promise<void> {
  core.startGroup('Generating GitHub summary')

  await core.summary
    .addHeading('✅ Preview deployment successful', 2)
    .addHeading('Deployment details', 3)
    .addTable([
      [
        { data: 'Field', header: true },
        { data: 'Value', header: true }
      ],
      [{ data: 'Tenant name' }, { data: data.tenantName }],
      [{ data: 'CI prefix' }, { data: data.ciPrefix }],
      [{ data: 'Namespace' }, { data: data.namespace }],
      [{ data: 'OCIRepository' }, { data: data.ociRepoName }],
      [{ data: 'Kustomization' }, { data: data.kustomizationName }],
      [{ data: 'Git branch' }, { data: data.gitBranch }]
    ])
    .addRaw(
      `\n---\n*Deployment timestamp: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC*`
    )
    .write()

  core.endGroup()
}

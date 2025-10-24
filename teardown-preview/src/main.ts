import * as core from '@actions/core'
import * as github from '@actions/github'
import * as k8s from '@kubernetes/client-node'
import {
  ActionInputs,
  ActionOutputs,
  Kustomization,
  OCIRepository
} from './types'
import {
  parseAgeToSeconds,
  calculateAge,
  formatAge,
  isProtected,
  sanitizeLabelValue
} from './utils'

async function run(): Promise<void> {
  try {
    const inputs: ActionInputs = {
      kubernetesContext: core.getInput('kubernetes-context', {
        required: true
      }),
      reference: core.getInput('reference'),
      ciPrefixLength: parseInt(core.getInput('ci-prefix-length') || '16', 10),
      waitForDeletion: core.getBooleanInput('wait-for-deletion'),
      timeout: core.getInput('timeout') || '5m',
      dryRun: core.getBooleanInput('dry-run'),
      maxAge: core.getInput('max-age')
    }

    const outputs: ActionOutputs = {
      deletedCount: 0,
      deletedResources: [],
      skippedCount: 0,
      skippedResources: []
    }

    core.startGroup('Verifying Kubernetes connectivity')

    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()

    const contexts = kc.getContexts()
    const contextExists = contexts.some(
      (ctx) => ctx.name === inputs.kubernetesContext
    )

    if (!contextExists) {
      throw new Error(
        `Kubernetes context '${inputs.kubernetesContext}' not found. Available contexts: ${contexts.map((c) => c.name).join(', ')}`
      )
    }

    kc.setCurrentContext(inputs.kubernetesContext)

    core.info(`Using context: ${inputs.kubernetesContext}`)

    const customApi = kc.makeApiClient(k8s.CustomObjectsApi)

    try {
      await customApi.listNamespacedCustomObject({
        group: 'source.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'ocirepositories',
        limit: 1
      })
    } catch (error: any) {
      if (error.statusCode === 403) {
        throw new Error(
          'Insufficient permissions to list OCIRepository resources in namespace infra-fluxcd'
        )
      }
      throw error
    }

    try {
      await customApi.listNamespacedCustomObject({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'kustomizations',
        limit: 1
      })
    } catch (error: any) {
      if (error.statusCode === 403) {
        throw new Error(
          'Insufficient permissions to list Kustomization resources in namespace infra-fluxcd'
        )
      }
      throw error
    }

    core.info('✅ Successfully connected to cluster with required permissions')
    core.endGroup()

    if (inputs.reference) {
      await handleTargetedDeletion(inputs, outputs, customApi)
    } else {
      await handleBulkDeletion(inputs, outputs, customApi)
    }

    core.setOutput('deleted-count', outputs.deletedCount)
    core.setOutput(
      'deleted-resources',
      JSON.stringify(outputs.deletedResources)
    )
    core.setOutput('skipped-count', outputs.skippedCount)
    core.setOutput(
      'skipped-resources',
      JSON.stringify(outputs.skippedResources)
    )

    await generateSummary(inputs, outputs)
  } catch (error) {
    core.setFailed(`Action failed: ${error}`)
  }
}

async function handleTargetedDeletion(
  inputs: ActionInputs,
  outputs: ActionOutputs,
  customApi: k8s.CustomObjectsApi
): Promise<void> {
  core.startGroup(
    `Targeting preview deployment with reference: ${inputs.reference}`
  )

  const ciReferenceLabel = sanitizeLabelValue(inputs.reference)

  core.info(
    `Searching for resources with ci-reference label: ${ciReferenceLabel}`
  )

  const labelSelector = `eidp.com/preview-deployment=true,eidp.com/ci-reference=${ciReferenceLabel}`

  const kustomizationsResponse = (await customApi.listNamespacedCustomObject({
    group: 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'kustomizations',
    labelSelector
  })) as { items: Kustomization[] }

  const ociReposResponse = (await customApi.listNamespacedCustomObject({
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'ocirepositories',
    labelSelector
  })) as { items: OCIRepository[] }

  const kustomizationCount = kustomizationsResponse.items.length
  const ociRepoCount = ociReposResponse.items.length

  if (kustomizationCount === 0 && ociRepoCount === 0) {
    core.info(
      `ℹ️ No preview deployment found with reference: ${inputs.reference} (ci-reference: ${ciReferenceLabel})`
    )
    outputs.skippedResources.push({
      name: inputs.reference,
      reason: 'Not found or already deleted'
    })
    outputs.skippedCount++
  } else {
    core.info(
      `Found preview deployment: ${kustomizationCount} Kustomization(s), ${ociRepoCount} OCIRepository(ies)`
    )

    if (inputs.dryRun) {
      core.info('ℹ️ DRY RUN: Would delete the following resources:')
      kustomizationsResponse.items.forEach((kust) => {
        core.info(`  - Kustomization: ${kust.metadata.name}`)
        outputs.deletedResources.push({
          type: 'Kustomization',
          name: kust.metadata.name,
          ciPrefix: ciReferenceLabel
        })
        outputs.deletedCount++
      })
      ociReposResponse.items.forEach((oci) => {
        core.info(`  - OCIRepository: ${oci.metadata.name}`)
      })
    } else {
      for (const kust of kustomizationsResponse.items) {
        await deleteKustomization(customApi, kust.metadata.name, inputs.dryRun)
        outputs.deletedResources.push({
          type: 'Kustomization',
          name: kust.metadata.name,
          ciPrefix: ciReferenceLabel
        })
        outputs.deletedCount++
      }

      for (const oci of ociReposResponse.items) {
        await deleteOCIRepository(customApi, oci.metadata.name, inputs.dryRun)
      }

      if (inputs.waitForDeletion) {
        await waitForDeletion(
          customApi,
          kustomizationsResponse.items,
          ociReposResponse.items,
          inputs.timeout
        )

        core.info(
          'Waiting an additional 30 seconds for FluxCD to process finalizers and prune managed resources...'
        )
        await new Promise((resolve) => setTimeout(resolve, 30000))
      }
    }
  }

  core.endGroup()
}

async function handleBulkDeletion(
  inputs: ActionInputs,
  outputs: ActionOutputs,
  customApi: k8s.CustomObjectsApi
): Promise<void> {
  core.startGroup('Discovering all preview deployments')

  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )
  core.info(`Filtering by repository: ${repositoryLabel}`)

  const response = (await customApi.listNamespacedCustomObject({
    group: 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    namespace: 'infra-fluxcd',
    plural: 'kustomizations',
    labelSelector: `eidp.com/preview-deployment=true,eidp.com/repository=${repositoryLabel}`
  })) as { items: Kustomization[] }

  const totalCount = response.items.length

  core.info(`Found ${totalCount} preview deployment(s)`)

  if (totalCount === 0) {
    core.info('ℹ️ No preview deployments to clean up')
    core.endGroup()
    return
  }

  const maxAgeSeconds = inputs.maxAge ? parseAgeToSeconds(inputs.maxAge) : 0
  if (maxAgeSeconds > 0) {
    core.info(`Filtering by age: older than ${formatAge(maxAgeSeconds)}`)
  }

  for (const kust of response.items) {
    const name = kust.metadata.name
    const ciReferenceLabel = kust.metadata.labels['eidp.com/ci-reference'] || ''
    const createdTimestamp = kust.metadata.creationTimestamp

    const ageSeconds = calculateAge(createdTimestamp)
    const ageDisplay = formatAge(ageSeconds)

    if (maxAgeSeconds > 0 && ageSeconds < maxAgeSeconds) {
      core.info(`  ⏭️ Skipping ${name} (age: ${ageDisplay}, below threshold)`)
      outputs.skippedResources.push({
        name,
        reason: `Too young (${ageDisplay})`,
        age: ageDisplay
      })
      outputs.skippedCount++
      continue
    }

    if (await isProtected(ciReferenceLabel)) {
      core.info(`  🔒 Skipping ${name} (protected by keep-preview label)`)
      outputs.skippedResources.push({
        name,
        reason: 'Protected by keep-preview label',
        age: ageDisplay
      })
      outputs.skippedCount++
      continue
    }

    if (inputs.dryRun) {
      core.info(`  ℹ️ Would delete: ${name} (age: ${ageDisplay})`)
    } else {
      core.info(`  🗑️ Deleting: ${name} (age: ${ageDisplay})`)
      await deleteKustomization(customApi, name, inputs.dryRun)

      if (ciReferenceLabel) {
        await deleteMatchingOCIRepository(
          customApi,
          ciReferenceLabel,
          inputs.dryRun
        )
      }

      if (inputs.waitForDeletion) {
        await waitForKustomizationDeletion(customApi, name, inputs.timeout)
      }
    }

    outputs.deletedResources.push({
      type: 'Kustomization',
      name,
      age: ageDisplay,
      ciPrefix: ciReferenceLabel
    })
    outputs.deletedCount++
  }

  core.endGroup()
}

async function deleteKustomization(
  customApi: k8s.CustomObjectsApi,
  name: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return

  try {
    await customApi.deleteNamespacedCustomObject({
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'kustomizations',
      name,
      propagationPolicy: 'Background'
    })
    core.info(`  ✅ Deleted Kustomization: ${name}`)
  } catch (error: any) {
    if (error.code === 404) {
      core.info(`  ℹ️ Kustomization ${name} already deleted`)
    } else {
      throw error
    }
  }
}

async function deleteOCIRepository(
  customApi: k8s.CustomObjectsApi,
  name: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return

  try {
    await customApi.deleteNamespacedCustomObject({
      group: 'source.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'ocirepositories',
      name,
      propagationPolicy: 'Background',
      body: {
        apiVersion: 'v1',
        kind: 'DeleteOptions',
        propagationPolicy: 'Background'
      }
    })
    core.info(`  ✅ Deleted OCIRepository: ${name}`)
  } catch (error: any) {
    if (error.code === 404) {
      core.info(`  ℹ️ OCIRepository ${name} already deleted`)
    } else {
      core.warning(`Failed to delete OCIRepository ${name}: ${error.message}`)
    }
  }
}

async function deleteMatchingOCIRepository(
  customApi: k8s.CustomObjectsApi,
  ciReferenceLabel: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return

  try {
    const response = (await customApi.listNamespacedCustomObject({
      group: 'source.toolkit.fluxcd.io',
      version: 'v1',
      namespace: 'infra-fluxcd',
      plural: 'ocirepositories',
      labelSelector: `eidp.com/preview-deployment=true,eidp.com/ci-reference=${ciReferenceLabel}`
    })) as { items: OCIRepository[] }

    for (const oci of response.items) {
      await deleteOCIRepository(customApi, oci.metadata.name, dryRun)
    }
  } catch (error: any) {
    core.warning(
      `Failed to find/delete matching OCIRepository for ci-reference ${ciReferenceLabel}: ${error.message}`
    )
  }
}

async function waitForDeletion(
  customApi: k8s.CustomObjectsApi,
  kustomizations: Kustomization[],
  ociRepositories: OCIRepository[],
  timeout: string
): Promise<void> {
  core.info('Waiting for resources to be fully deleted...')

  const timeoutMs = parseTimeout(timeout)
  const startTime = Date.now()

  for (const kust of kustomizations) {
    await waitForKustomizationDeletion(customApi, kust.metadata.name, timeout)
    if (Date.now() - startTime > timeoutMs) {
      core.warning('Timeout reached while waiting for deletion')
      return
    }
  }

  for (const oci of ociRepositories) {
    await waitForOCIRepositoryDeletion(customApi, oci.metadata.name, timeout)
    if (Date.now() - startTime > timeoutMs) {
      core.warning('Timeout reached while waiting for deletion')
      return
    }
  }

  core.info('✅ Resources deleted successfully')
}

async function waitForKustomizationDeletion(
  customApi: k8s.CustomObjectsApi,
  name: string,
  timeout: string
): Promise<void> {
  const timeoutMs = parseTimeout(timeout)
  const startTime = Date.now()
  const pollInterval = 2000

  while (Date.now() - startTime < timeoutMs) {
    try {
      await customApi.getNamespacedCustomObject({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'kustomizations',
        name
      })
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    } catch (error: any) {
      if (error.code === 404) {
        return
      }
      throw error
    }
  }
}

async function waitForOCIRepositoryDeletion(
  customApi: k8s.CustomObjectsApi,
  name: string,
  timeout: string
): Promise<void> {
  const timeoutMs = parseTimeout(timeout)
  const startTime = Date.now()
  const pollInterval = 2000

  while (Date.now() - startTime < timeoutMs) {
    try {
      await customApi.getNamespacedCustomObject({
        group: 'source.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'ocirepositories',
        name
      })
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    } catch (error: any) {
      if (error.code === 404) {
        return
      }
      throw error
    }
  }
}

function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)([smh])$/)
  if (!match) {
    return 300000
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 's':
      return value * 1000
    case 'm':
      return value * 60000
    case 'h':
      return value * 3600000
    default:
      return 300000
  }
}

async function generateSummary(
  inputs: ActionInputs,
  outputs: ActionOutputs
): Promise<void> {
  core.startGroup('Generating GitHub summary')

  const summary = core.summary

  if (inputs.dryRun) {
    summary.addHeading('ℹ️ Dry Run: Preview Teardown Report', 2)
  } else if (outputs.deletedCount > 0) {
    summary.addHeading('✅ Preview Teardown Successful', 2)
  } else {
    summary.addHeading('ℹ️ No Previews to Clean Up', 2)
  }

  summary.addHeading('Teardown Summary', 3)
  summary.addTable([
    [
      { data: 'Metric', header: true },
      { data: 'Count', header: true }
    ],
    [
      { data: inputs.dryRun ? '**Would delete**' : '**Deleted**' },
      { data: outputs.deletedCount.toString() }
    ],
    [{ data: '**Skipped**' }, { data: outputs.skippedCount.toString() }]
  ])

  if (outputs.deletedCount > 0) {
    summary.addHeading(inputs.dryRun ? 'Would Delete' : 'Deleted Resources', 3)
    summary.addTable([
      [
        { data: 'Resource', header: true },
        { data: 'Type', header: true },
        { data: 'Age', header: true },
        { data: 'CI Prefix', header: true }
      ],
      ...outputs.deletedResources.map((r) => [
        { data: r.name },
        { data: r.type },
        { data: r.age || 'N/A' },
        { data: r.ciPrefix || 'N/A' }
      ])
    ])
  }

  if (outputs.skippedCount > 0) {
    summary.addHeading('Skipped Resources', 3)
    summary.addTable([
      [
        { data: 'Resource', header: true },
        { data: 'Reason', header: true },
        { data: 'Age', header: true }
      ],
      ...outputs.skippedResources.map((r) => [
        { data: r.name },
        { data: r.reason },
        { data: r.age || 'N/A' }
      ])
    ])
  }

  summary.addHeading('Teardown Details', 3)
  const detailsTable: Array<[{ data: string }, { data: string }]> = [
    [
      { data: '**Kubernetes Context**' },
      { data: `\`${inputs.kubernetesContext}\`` }
    ]
  ]

  if (inputs.reference) {
    detailsTable.push([
      { data: '**Target Reference**' },
      { data: `\`${inputs.reference}\`` }
    ])
  } else {
    detailsTable.push([{ data: '**Scope**' }, { data: 'Bulk cleanup' }])
    if (inputs.maxAge) {
      detailsTable.push([
        { data: '**Max Age**' },
        { data: `\`${inputs.maxAge}\`` }
      ])
    }
  }

  if (inputs.waitForDeletion) {
    detailsTable.push([
      { data: '**Wait for Deletion**' },
      { data: `\`${inputs.timeout}\`` }
    ])
  }

  summary.addTable(detailsTable)

  summary.addRaw('---')
  summary.addRaw(
    `*Teardown timestamp: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC*`
  )

  await summary.write()

  core.endGroup()
}

run()

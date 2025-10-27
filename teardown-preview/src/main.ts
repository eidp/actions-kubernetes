import * as core from '@actions/core'
import * as github from '@actions/github'
import { ActionInputs, ActionOutputs } from './types'
import {
  parseAgeToSeconds,
  calculateAge,
  formatAge,
  isProtected,
  sanitizeLabelValue
} from './utils'
import { postTeardownComment } from './pr-comments'
import {
  verifyKubernetesConnectivity,
  findResourcesByLabel,
  listKustomizations,
  deleteKustomization,
  deleteOCIRepository,
  deleteMatchingOCIRepository,
  waitForDeletion,
  waitForKustomizationDeletion
} from './k8s-operations'
import { generateSummary } from './summary'

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token')

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

    const kc = await verifyKubernetesConnectivity(inputs.kubernetesContext)

    if (inputs.reference) {
      await handleTargetedDeletion(inputs, outputs, kc, githubToken)
    } else {
      await handleBulkDeletion(inputs, outputs, kc, githubToken)
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
  kc: any,
  githubToken: string
): Promise<void> {
  core.startGroup(
    `Targeting preview deployment with reference: ${inputs.reference}`
  )

  const ciReferenceLabel = sanitizeLabelValue(inputs.reference)

  core.info(
    `Searching for resources with ci-reference label: ${ciReferenceLabel}`
  )

  const labelSelector = `eidp.com/preview-deployment=true,eidp.com/ci-reference=${ciReferenceLabel}`

  const { kustomizations, ociRepositories } = await findResourcesByLabel(
    kc,
    labelSelector
  )

  const kustomizationCount = kustomizations.length
  const ociRepoCount = ociRepositories.length

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
      kustomizations.forEach((kust) => {
        core.info(`  - Kustomization: ${kust.metadata.name}`)
        outputs.deletedResources.push({
          type: 'Kustomization',
          name: kust.metadata.name,
          ciPrefix: ciReferenceLabel
        })
        outputs.deletedCount++
      })
      ociRepositories.forEach((oci) => {
        core.info(`  - OCIRepository: ${oci.metadata.name}`)
      })
    } else {
      for (const kust of kustomizations) {
        await deleteKustomization(kc, kust.metadata.name, inputs.dryRun)
        outputs.deletedResources.push({
          type: 'Kustomization',
          name: kust.metadata.name,
          ciPrefix: ciReferenceLabel
        })
        outputs.deletedCount++
      }

      for (const oci of ociRepositories) {
        await deleteOCIRepository(kc, oci.metadata.name, inputs.dryRun)
      }

      if (inputs.waitForDeletion) {
        await waitForDeletion(
          kc,
          kustomizations,
          ociRepositories,
          inputs.timeout
        )

        core.info(
          'Waiting an additional 30 seconds for FluxCD to process finalizers and prune managed resources...'
        )
        await new Promise((resolve) => setTimeout(resolve, 30000))
      }

      // Post PR comment (manual teardown, no timeout)
      await postTeardownComment(githubToken, inputs.reference, false)
    }
  }

  core.endGroup()
}

async function handleBulkDeletion(
  inputs: ActionInputs,
  outputs: ActionOutputs,
  kc: any,
  githubToken: string
): Promise<void> {
  core.startGroup('Discovering all preview deployments')

  const repositoryLabel = sanitizeLabelValue(
    `${github.context.repo.owner}_${github.context.repo.repo}`
  )
  core.info(`Filtering by repository: ${repositoryLabel}`)

  const kustomizations = await listKustomizations(
    kc,
    `eidp.com/preview-deployment=true,eidp.com/repository=${repositoryLabel}`
  )

  const totalCount = kustomizations.length

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

  for (const kust of kustomizations) {
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
      await deleteKustomization(kc, name, inputs.dryRun)

      if (ciReferenceLabel) {
        await deleteMatchingOCIRepository(kc, ciReferenceLabel, inputs.dryRun)
      }

      if (inputs.waitForDeletion) {
        await waitForKustomizationDeletion(kc, name, inputs.timeout)
      }

      // Post PR comment (timeout-triggered deletion)
      if (ciReferenceLabel) {
        await postTeardownComment(
          githubToken,
          ciReferenceLabel,
          true,
          ageDisplay
        )
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

run()

import * as core from '@actions/core'
import * as github from '@actions/github'
import { sanitizeName } from '@actions-kubernetes/shared/string-utils'

export function reconstructCiPrefix(
  reference: string,
  prefixLength: number
): string {
  if (prefixLength > 24) {
    throw new Error(
      `The 'ci-prefix-length' input cannot be greater than 24, but got: ${prefixLength}`
    )
  }

  const prefix = `ci-${reference.substring(0, prefixLength)}-`
  return sanitizeName(prefix)
}

export function getCiPrefixLabel(ciPrefix: string): string {
  return ciPrefix.replace(/-+$/, '')
}

export async function isProtected(
  prNumber: number,
  token: string
): Promise<boolean> {
  if (!token) {
    core.warning(
      'GitHub token not provided, skipping protection check for pr: ' + prNumber
    )
    return false
  }

  try {
    const octokit = github.getOctokit(token)
    const context = github.context

    const { data: pr } = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber
    })

    const hasProtectionLabel = pr.labels.some(
      (label) => label.name === 'keep-preview'
    )

    if (hasProtectionLabel) {
      core.info(
        `PR #${prNumber} has 'keep-preview' label - protecting from deletion`
      )
    }

    return hasProtectionLabel
  } catch (error: unknown) {
    const hasStatus = error instanceof Error && 'status' in error
    const status = hasStatus ? (error as { status: number }).status : null
    const message = error instanceof Error ? error.message : String(error)

    if (status === 404) {
      core.debug(`PR #${prNumber} not found, treating as not protected`)
      return false
    }

    core.warning(`Failed to check protection for PR #${prNumber}: ${message}`)
    return false
  }
}

import * as core from '@actions/core'
import * as github from '@actions/github'

export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export function sanitizeLabelValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .substring(0, 63)
    .replace(/[^a-z0-9]+$/, '')
}

export function parseAgeToSeconds(ageStr: string): number {
  const dayMatch = ageStr.match(/^(\d+)d$/)
  if (dayMatch) {
    return parseInt(dayMatch[1], 10) * 86400
  }

  const hourMatch = ageStr.match(/^(\d+)h$/)
  if (hourMatch) {
    return parseInt(hourMatch[1], 10) * 3600
  }

  const minMatch = ageStr.match(/^(\d+)m$/)
  if (minMatch) {
    return parseInt(minMatch[1], 10) * 60
  }

  throw new Error(
    `Invalid age format: ${ageStr}. Use format like 7d, 48h, or 30m`
  )
}

export function calculateAge(createdTimestamp: string): number {
  const created = new Date(createdTimestamp).getTime()
  const now = Date.now()
  return Math.floor((now - created) / 1000)
}

export function formatAge(ageSeconds: number): string {
  const days = Math.floor(ageSeconds / 86400)
  const hours = Math.floor((ageSeconds % 86400) / 3600)
  const minutes = Math.floor((ageSeconds % 3600) / 60)

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

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

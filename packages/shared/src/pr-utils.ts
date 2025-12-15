import * as core from '@actions/core'
import * as github from '@actions/github'

export function getPRNumber(): number | null {
  // Works for both pull_request and issue_comment events
  if (github.context.issue?.number) {
    core.debug('PR number from pull_request or issue_comment event')
    return github.context.issue.number
  }

  return null
}

export function getWorkflowRunUrl(): string {
  return `${github.context.serverUrl}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${github.context.runId}`
}

export interface PRDetails {
  sha: string
  branch: string
  repo?: string
}

/**
 * Gets PR details from GitHub API.
 *
 * When workflows are triggered by slash commands (issue_comment event), github.context
 * contains information about the default branch, not the PR. This function fetches
 * the correct PR details (HEAD SHA and branch name) from the GitHub API.
 */
export async function getPRDetails(
  token: string,
  prNumber: number
): Promise<PRDetails> {
  const octokit = github.getOctokit(token)

  const { data: pr } = await octokit.rest.pulls.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber
  })

  return {
    sha: pr.head.sha,
    branch: pr.head.ref,
    repo: pr.head.repo?.name
  }
}

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

/**
 * Gets PR HEAD commit SHA from GitHub API.
 *
 * When workflows are triggered by slash commands (issue_comment event), github.context.sha
 * points to the default branch commit, not the PR's HEAD commit. This function fetches
 * the correct PR HEAD SHA from the GitHub API.
 */
export async function getPRHeadSha(
  token: string,
  prNumber: number
): Promise<string> {
  const octokit = github.getOctokit(token)

  const { data: pr } = await octokit.rest.pulls.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber
  })

  return pr.head.sha
}

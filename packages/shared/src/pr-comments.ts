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

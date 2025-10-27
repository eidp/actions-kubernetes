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

export async function postOrUpdatePRComment(
  token: string,
  prNumber: number,
  body: string,
  marker: string
): Promise<void> {
  try {
    if (!token) {
      core.warning('No GitHub token provided, skipping PR comment')
      return
    }

    const octokit = github.getOctokit(token)

    // Search for existing comment
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: prNumber
    })

    const existingComment = comments.find((comment) =>
      comment.body?.includes(marker)
    )

    const fullBody = `${marker}\n${body}`

    if (existingComment) {
      core.info(`Updating existing PR comment #${existingComment.id}`)
      await octokit.rest.issues.updateComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        comment_id: existingComment.id,
        body: fullBody
      })
    } else {
      core.info(`Creating new PR comment on #${prNumber}`)
      await octokit.rest.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: prNumber,
        body: fullBody
      })
    }

    core.info('✅ PR comment posted successfully')
  } catch (error: any) {
    if (error.status === 403) {
      core.warning(
        'Insufficient permissions to post PR comment. Ensure the github-token has pull-requests:write permission.'
      )
    } else if (error.status === 404) {
      core.warning(`PR #${prNumber} not found or comment access denied`)
    } else {
      core.warning(`Failed to post PR comment: ${error.message}`)
    }
  }
}

export async function checkIfPROpen(
  token: string,
  prNumber: number
): Promise<boolean> {
  try {
    if (!token) {
      return false
    }

    const octokit = github.getOctokit(token)
    const { data: pr } = await octokit.rest.pulls.get({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: prNumber
    })

    return pr.state === 'open'
  } catch (error: any) {
    if (error.status === 404) {
      core.debug(`PR #${prNumber} not found`)
      return false
    }
    core.warning(`Failed to check PR status: ${error.message}`)
    return false
  }
}

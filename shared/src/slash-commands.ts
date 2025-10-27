import * as core from '@actions/core'
import * as github from '@actions/github'

export interface SlashCommandContext {
  isSlashCommand: boolean
  command: string | null
  commentId: number | null
  commenter: string | null
  prNumber: number | null
  shouldExecute: boolean
}

/**
 * Detects if this is a slash command execution and parses the command
 * @param expectedCommand - The command this action expects (e.g., 'deploy' or 'teardown')
 * @returns Context about the slash command
 */
export async function detectSlashCommand(
  expectedCommand: string
): Promise<SlashCommandContext> {
  const eventName = github.context.eventName

  // Not an issue_comment event
  if (eventName !== 'issue_comment') {
    core.debug('Not an issue_comment event, proceeding with normal execution')
    return {
      isSlashCommand: false,
      command: null,
      commentId: null,
      commenter: null,
      prNumber: null,
      shouldExecute: true
    }
  }

  core.info('Detected issue_comment event, checking for slash command')

  // Verify this is a PR comment, not an issue comment
  if (!github.context.payload.issue?.pull_request) {
    core.info('Comment is not on a pull request, skipping')
    return {
      isSlashCommand: true,
      command: null,
      commentId: github.context.payload.comment?.id || null,
      commenter: github.context.payload.comment?.user?.login || null,
      prNumber: null,
      shouldExecute: false
    }
  }

  const commentBody = github.context.payload.comment?.body || ''
  const match = commentBody.match(/^\/(\w+)(?:\s+(.*))?$/m)

  if (!match) {
    core.info('No slash command found in comment')
    return {
      isSlashCommand: true,
      command: null,
      commentId: github.context.payload.comment?.id || null,
      commenter: github.context.payload.comment?.user?.login || null,
      prNumber: github.context.issue.number,
      shouldExecute: false
    }
  }

  const command = match[1].toLowerCase()
  core.info(`Detected slash command: /${command}`)

  // Check if command matches what this action expects
  if (command !== expectedCommand) {
    core.info(
      `Command '/${command}' does not match expected '/${expectedCommand}', skipping`
    )
    return {
      isSlashCommand: true,
      command,
      commentId: github.context.payload.comment?.id || null,
      commenter: github.context.payload.comment?.user?.login || null,
      prNumber: github.context.issue.number,
      shouldExecute: false
    }
  }

  core.info(`Command matches, will execute ${expectedCommand} operation`)
  return {
    isSlashCommand: true,
    command,
    commentId: github.context.payload.comment!.id,
    commenter: github.context.payload.comment!.user.login,
    prNumber: github.context.issue.number,
    shouldExecute: true
  }
}

/**
 * Checks if the commenter has write access to the repository
 */
export async function checkPermissions(
  token: string,
  username: string
): Promise<boolean> {
  const octokit = github.getOctokit(token)

  try {
    const { data: permission } =
      await octokit.rest.repos.getCollaboratorPermissionLevel({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        username
      })

    const hasWriteAccess = ['write', 'admin'].includes(permission.permission)

    if (!hasWriteAccess) {
      core.info(
        `User ${username} has ${permission.permission} access (requires write or admin)`
      )
    }

    return hasWriteAccess
  } catch (error: any) {
    core.warning(
      `Failed to check permissions for ${username}: ${error.message}`
    )
    return false
  }
}

/**
 * Posts a permission denied message and reaction
 */
export async function rejectUnauthorised(
  token: string,
  prNumber: number,
  commentId: number,
  username: string
): Promise<void> {
  const octokit = github.getOctokit(token)

  try {
    // Post comment
    await octokit.rest.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: prNumber,
      body: `❌ **Permission denied**\n\n@${username}, you need write access to this repository to use slash commands.`
    })

    // Add thumbs down reaction
    await octokit.rest.reactions.createForIssueComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: commentId,
      content: '-1'
    })

    core.setFailed(`User ${username} does not have write access`)
  } catch (error: any) {
    core.warning(`Failed to post permission denied message: ${error.message}`)
    throw error
  }
}

/**
 * Adds a reaction to a comment
 */
export async function addReaction(
  token: string,
  commentId: number,
  reaction: '+1' | '-1' | 'eyes'
): Promise<void> {
  const octokit = github.getOctokit(token)

  try {
    await octokit.rest.reactions.createForIssueComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: commentId,
      content: reaction
    })
    core.info(`Added ${reaction} reaction to comment`)
  } catch (error: any) {
    core.warning(`Failed to add reaction: ${error.message}`)
  }
}

/**
 * Gets PR details from issue_comment event
 */
export async function getPRDetailsFromComment(
  token: string,
  prNumber: number
): Promise<{
  number: number
  head_ref: string
  head_sha: string
  base_ref: string
}> {
  const octokit = github.getOctokit(token)

  const { data: pr } = await octokit.rest.pulls.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber
  })

  return {
    number: pr.number,
    head_ref: pr.head.ref,
    head_sha: pr.head.sha,
    base_ref: pr.base.ref
  }
}

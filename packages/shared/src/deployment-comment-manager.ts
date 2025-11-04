import * as core from '@actions/core'
import * as github from '@actions/github'
import { getWorkflowRunUrl } from './pr-utils.js'
import { STATUS_EMOJI, STATUS_TITLE, STATUS_DESCRIPTION } from './constants.js'

export interface VerifiedResource {
  name: string
  type: string
  ready: string
  message?: string
}

export interface DeploymentDetails {
  namespace?: string
  tenant?: string
  url?: string
  error?: string
  deletedCount?: number
  wasTimeoutTriggered?: boolean
  age?: string
  verifiedResources?: VerifiedResource[]
  environment: string
}

export enum DeploymentStatus {
  Deployed = 'deployed',
  Verified = 'verified',
  Failed = 'failed',
  TornDown = 'torndown'
}

/**
 * Manages deployment comments on GitHub PRs
 */
export class DeploymentCommentManager {
  private readonly octokit: ReturnType<typeof github.getOctokit> | null = null
  private readonly owner: string = ''
  private readonly repo: string = ''
  private readonly prNumber: number | null = null
  private readonly workflowName: string = ''
  private readonly commit: string = ''
  private readonly commitUrl: string = ''
  private readonly workflowRunUrl: string = ''

  constructor(token: string, prNumber: number | null, commitSha: string) {
    if (!token) {
      core.debug('No GitHub token provided, comment manager will no-op')
      return
    }

    this.octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo
    this.owner = owner
    this.repo = repo
    this.prNumber = prNumber
    this.workflowName = github.context.workflow
    this.commit = commitSha
    this.commitUrl = `https://github.com/${owner}/${repo}/commit/${this.commit}`
    this.workflowRunUrl = getWorkflowRunUrl()
  }

  /**
   * Create or update deployment comment
   */
  async createOrUpdateDeploymentComment(
    status: DeploymentStatus,
    details: DeploymentDetails
  ): Promise<void> {
    if (!this.octokit || !this.prNumber) {
      core.debug('Skipping PR comment - no token or no PR context')
      return
    }

    try {
      // Minimize all previous comments (both deployment and teardown)
      const previousComments = await this.findAllPreviousComments()

      if (previousComments.length > 0) {
        core.info(
          `Minimizing ${previousComments.length} previous comment(s) for PR #${this.prNumber}`
        )
        await this.minimizeComments(previousComments.map((c) => c.node_id))
      }

      // Find existing comment for this commit
      const existingComment = await this.findComment()

      // Generate comment body
      const identifier = this.getCommentIdentifier()
      const body = this.generateCommentBody(identifier, status, details)

      if (existingComment) {
        // Update existing comment
        await this.octokit.rest.issues.updateComment({
          owner: this.owner,
          repo: this.repo,
          comment_id: existingComment.id,
          body
        })
        core.info(
          `Updated deployment comment for PR #${this.prNumber}, commit ${this.commit.substring(0, 7)}`
        )
      } else {
        // Create new comment
        await this.octokit.rest.issues.createComment({
          owner: this.owner,
          repo: this.repo,
          issue_number: this.prNumber,
          body
        })
        core.info(
          `Created deployment comment for PR #${this.prNumber}, commit ${this.commit.substring(0, 7)}`
        )
      }
    } catch (error) {
      core.warning(
        `Failed to post deployment comment: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Create or update teardown comment
   */
  async createOrUpdateTeardownComment(
    details: DeploymentDetails
  ): Promise<void> {
    if (!this.octokit || !this.prNumber) {
      core.debug('Skipping PR comment - no token or no PR context')
      return
    }

    try {
      // Minimize all previous comments (from other commits)
      const previousComments = await this.findAllPreviousComments()

      if (previousComments.length > 0) {
        core.info(
          `Minimizing ${previousComments.length} previous comment(s) for PR #${this.prNumber}`
        )
        await this.minimizeComments(previousComments.map((c) => c.node_id))
      }

      // Find existing comment for this commit
      const existingComment = await this.findComment()

      // Generate comment body
      const identifier = this.getCommentIdentifier()
      const body = this.generateCommentBody(
        identifier,
        DeploymentStatus.TornDown,
        details
      )

      if (existingComment) {
        // Update existing comment
        await this.octokit.rest.issues.updateComment({
          owner: this.owner,
          repo: this.repo,
          comment_id: existingComment.id,
          body
        })
        core.info(
          `Updated comment to show teardown for PR #${this.prNumber}, commit ${this.commit.substring(0, 7)}`
        )
      } else {
        // Create new comment
        await this.octokit.rest.issues.createComment({
          owner: this.owner,
          repo: this.repo,
          issue_number: this.prNumber,
          body
        })
        core.info(
          `Created teardown comment for PR #${this.prNumber}, commit ${this.commit.substring(0, 7)}`
        )
      }
    } catch (error) {
      core.warning(
        `Failed to post teardown comment: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Generate HTML comment identifier for finding/updating comments
   */
  private getCommentIdentifier(): string {
    return `<!-- actions-kubernetes: pr=${this.prNumber}, workflow=${this.workflowName}, commit=${this.commit} -->`
  }

  /**
   * Find existing comment for this commit
   */
  private async findComment(): Promise<{
    id: number
    node_id: string
    body?: string
  } | null> {
    if (!this.octokit || !this.prNumber) return null

    const identifier = this.getCommentIdentifier()

    const comments = await this.octokit.paginate(
      this.octokit.rest.issues.listComments,
      {
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber
      }
    )

    return (
      comments.find((comment) => comment.body?.startsWith(identifier)) || null
    )
  }

  /**
   * Find all previous comments for this PR+workflow (excluding current commit)
   */
  private async findAllPreviousComments(): Promise<
    Array<{ id: number; node_id: string; body?: string }>
  > {
    if (!this.octokit || !this.prNumber) return []

    const comments = await this.octokit.paginate(
      this.octokit.rest.issues.listComments,
      {
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber
      }
    )

    const commentPattern = `<!-- actions-kubernetes: pr=${this.prNumber}, workflow=${this.workflowName}, commit=`
    const currentIdentifier = this.getCommentIdentifier()

    return comments.filter((comment) => {
      const body = comment.body || ''

      // Check if it's a comment for this PR+workflow
      const isRelevantComment = body.startsWith(commentPattern)

      if (!isRelevantComment) {
        return false
      }

      // Exclude comments from the current commit
      return !body.startsWith(currentIdentifier)
    })
  }

  /**
   * Minimize comments using GraphQL API
   */
  private async minimizeComments(commentNodeIds: string[]): Promise<void> {
    if (!this.octokit) return

    for (const nodeId of commentNodeIds) {
      try {
        await this.octokit.graphql(
          `
          mutation($nodeId: ID!) {
            minimizeComment(input: {subjectId: $nodeId, classifier: OUTDATED}) {
              minimizedComment {
                isMinimized
              }
            }
          }
        `,
          { nodeId }
        )
        core.info(`Minimized comment ${nodeId}`)
      } catch (error) {
        core.warning(
          `Failed to minimize comment ${nodeId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  /**
   * Generate resources table for displaying resource details
   */
  private generateResourcesTable(
    resources: VerifiedResource[],
    title: string
  ): string {
    let table = `\n**${title}:**\n\n`
    table += `| Resource | Type | Status |\n`
    table += `|----------|------|--------|\n`

    for (const resource of resources) {
      const statusIcon = resource.ready === 'True' ? '✅' : '❌'
      table += `| ${resource.name} | ${resource.type} | ${statusIcon} ${resource.ready} |\n`
    }

    table += `\n`
    return table
  }

  /**
   * Generate comment body for any deployment status
   */
  private generateCommentBody(
    identifier: string,
    status: DeploymentStatus,
    details: DeploymentDetails
  ): string {
    // Handle teardown status separately
    if (status === DeploymentStatus.TornDown) {
      return this.generateTeardownCommentBody(identifier, details)
    }

    let body = `${identifier}\n\n`
    body += `${STATUS_EMOJI[status]} **${STATUS_TITLE[status]}**\n\n`
    body += `${STATUS_DESCRIPTION[status](details.environment)}\n\n`

    if (status === 'verified' && details.url) {
      body += `**Application URL:** [${details.url}](${details.url})\n\n`
    }

    body += `**Deployment details:**\n`

    if (details.namespace) {
      body += `- Namespace: \`${details.namespace}\`\n`
    }

    if (details.tenant) {
      body += `- Tenant: \`${details.tenant}\`\n`
    }

    body += `- Commit: [\`${this.commit.substring(0, 7)}\`](${this.commitUrl})\n`

    if (details.verifiedResources && details.verifiedResources.length > 0) {
      const title =
        status === 'verified' ? 'Verified resources' : 'Resource status'
      body += this.generateResourcesTable(details.verifiedResources, title)
    }

    if (status === 'failed') {
      if (details.error) {
        body += `\n**Error details:**\n\`\`\`\n${details.error}\n\`\`\`\n`
      }
    }

    body += `\n_See [workflow run](${this.workflowRunUrl}) for full details._\n`

    // Only show slash commands for preview environments (starting with pr-)
    if (details.environment.startsWith('pr-')) {
      body += `\n---\n**Available commands:**\n`
      body += `- \`/deploy\` - Redeploy this environment\n`
      body += `- \`/teardown\` - Remove this environment\n`
    }

    return body
  }

  /**
   * Generate teardown comment body
   */
  private generateTeardownCommentBody(
    identifier: string,
    details: DeploymentDetails
  ): string {
    let body = `${identifier}\n\n🗑️ **Environment torn down**\n\n`

    if (details.wasTimeoutTriggered) {
      body += `Environment \`${details.environment}\` was automatically destroyed because the configured timeout has passed.\n\n`
      body += `💡 **Tip:** To keep an environment, add the \`keep-preview\` label to your PR.\n\n`
    } else {
      body += `Environment \`${details.environment}\` has been manually torn down.\n\n`
    }

    body += `**Details:**\n`

    if (details.namespace) {
      body += `- Namespace: \`${details.namespace}\`\n`
    }

    if (details.deletedCount !== undefined) {
      body += `- Resources deleted: \`${details.deletedCount}\`\n`
    }

    if (details.age) {
      body += `- Age: \`${details.age}\`\n`
    }

    body += `- Commit: [\`${this.commit.substring(0, 7)}\`](${this.commitUrl})\n`

    body += `\n_See [workflow run](${this.workflowRunUrl}) for full details._\n`

    // Only show slash commands for preview environments (starting with pr-)
    if (details.environment.startsWith('pr-')) {
      body += `\n---\n**Available commands:**\n`
      body += `- \`/deploy\` - Redeploy this environment\n`
    }

    return body
  }
}

import * as core from '@actions/core'
import * as github from '@actions/github'
import { getPRNumber, getWorkflowRunUrl } from './pr-comments'

export interface DeploymentDetails {
  namespace?: string
  tenant?: string
  url?: string
  error?: string
  deletedCount?: number
  wasTimeoutTriggered?: boolean
  age?: string
}

export enum DeploymentStatus {
  Deploying = 'deploying',
  Deployed = 'deployed',
  Verified = 'verified',
  Failed = 'failed'
}

enum CommentType {
  Deployment = 'deployment',
  Teardown = 'teardown'
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

  constructor(token: string, prNumber?: number | null) {
    if (!token) {
      core.debug('No GitHub token provided, comment manager will no-op')
      return
    }

    this.octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo
    this.owner = owner
    this.repo = repo
    this.prNumber = prNumber !== undefined ? prNumber : getPRNumber()
    this.workflowName = github.context.workflow
    this.commit = github.context.sha
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
      const existingComment = await this.findComment(CommentType.Deployment)

      // Generate comment body
      const identifier = this.getCommentIdentifier(CommentType.Deployment)
      const body = this.generateDeploymentCommentBody(
        identifier,
        status,
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
   * Create teardown comment (minimizes deployment comment first)
   */
  async createTeardownComment(details: DeploymentDetails): Promise<void> {
    if (!this.octokit || !this.prNumber) {
      core.debug('Skipping PR comment - no token or no PR context')
      return
    }

    try {
      // Find and minimize the deployment comment for this commit
      const deploymentComment = await this.findComment(CommentType.Deployment)

      if (deploymentComment) {
        await this.minimizeComments([deploymentComment.node_id])
      }

      // Find existing teardown comment for this commit
      const existingComment = await this.findComment(CommentType.Teardown)

      // Generate comment body
      const identifier = this.getCommentIdentifier(CommentType.Teardown)
      const body = this.generateTeardownCommentBody(identifier, details)

      if (existingComment) {
        // Update existing teardown comment
        await this.octokit.rest.issues.updateComment({
          owner: this.owner,
          repo: this.repo,
          comment_id: existingComment.id,
          body
        })
        core.info(
          `Updated teardown comment for PR #${this.prNumber}, commit ${this.commit.substring(0, 7)}`
        )
      } else {
        // Create new teardown comment
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
  private getCommentIdentifier(type: CommentType): string {
    return `<!-- actions-kubernetes-${type}: pr=${this.prNumber}, workflow=${this.workflowName}, commit=${this.commit} -->`
  }

  /**
   * Find existing comment of specified type for this commit
   */
  private async findComment(type: CommentType): Promise<{
    id: number
    node_id: string
    body?: string
  } | null> {
    if (!this.octokit || !this.prNumber) return null

    const identifier = this.getCommentIdentifier(type)

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
   * Find all previous deployment and teardown comments for this PR+workflow (excluding current commit)
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

    const deploymentPattern = `<!-- actions-kubernetes-${CommentType.Deployment}: pr=${this.prNumber}, workflow=${this.workflowName}, commit=`
    const teardownPattern = `<!-- actions-kubernetes-${CommentType.Teardown}: pr=${this.prNumber}, workflow=${this.workflowName}, commit=`

    return comments.filter((comment) => {
      const body = comment.body || ''

      // Check if it's either a deployment or teardown comment for this PR+workflow
      const isRelevantComment =
        body.startsWith(deploymentPattern) || body.startsWith(teardownPattern)

      if (!isRelevantComment) {
        return false
      }

      // Exclude comments from the current commit
      const currentDeploymentId = this.getCommentIdentifier(
        CommentType.Deployment
      )
      const currentTeardownId = this.getCommentIdentifier(CommentType.Teardown)

      return (
        !body.startsWith(currentDeploymentId) &&
        !body.startsWith(currentTeardownId)
      )
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
   * Generate deployment comment body
   */
  private generateDeploymentCommentBody(
    identifier: string,
    status: DeploymentStatus,
    details: DeploymentDetails
  ): string {
    const statusEmoji = {
      deploying: '🚀',
      deployed: '✅',
      verified: '✅',
      failed: '❌'
    }

    const statusTitle = {
      deploying: 'Deployment in progress',
      deployed: 'Resources created',
      verified: 'Deployment verified',
      failed: 'Deployment failed'
    }

    let body = `${identifier}\n\n${statusEmoji[status]} **${statusTitle[status]}**\n\n`

    body += `**Details:**\n`

    if (details.namespace) {
      body += `- Namespace: \`${details.namespace}\`\n`
    }

    if (details.tenant) {
      body += `- Tenant: \`${details.tenant}\`\n`
    }

    body += `- Commit: [\`${this.commit.substring(0, 7)}\`](${this.commitUrl})\n`
    body += `- Workflow: [View run](${this.workflowRunUrl})\n`

    if (status === 'verified' && details.url) {
      body += `\n**Application URL:** ${details.url}\n`
    }

    if (status === 'failed' && details.error) {
      body += `\n**Error:** ${details.error}\n`
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
      body += `Your preview environment was automatically destroyed because the configured timeout has passed.\n\n`
      body += `💡 **Tip:** To keep a preview environment, add the \`keep-preview\` label to your PR.\n\n`
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
    body += `- Workflow: [View run](${this.workflowRunUrl})\n`

    body += `\n_See [workflow run](${this.workflowRunUrl}) for full details._\n`

    return body
  }
}

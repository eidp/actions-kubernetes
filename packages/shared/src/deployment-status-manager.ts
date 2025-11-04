import * as core from '@actions/core'
import * as github from '@actions/github'

export type DeploymentState =
  | 'error'
  | 'failure'
  | 'inactive'
  | 'in_progress'
  | 'queued'
  | 'pending'
  | 'success'

/**
 * Manages GitHub deployment status updates
 */
export class DeploymentStatusManager {
  private readonly octokit: ReturnType<typeof github.getOctokit> | null = null
  private readonly owner: string = ''
  private readonly repo: string = ''
  private readonly environment: string = ''

  constructor(token: string, environment: string) {
    if (!token) {
      core.debug(
        'No GitHub token provided, deployment status manager will no-op'
      )
      return
    }

    if (!environment) {
      core.debug(
        'No environment provided, deployment status manager will no-op'
      )
      return
    }

    this.octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo
    this.owner = owner
    this.repo = repo
    this.environment = environment
  }

  /**
   * Updates the deployment status with a URL for the current workflow run
   */
  async updateDeploymentStatus(
    state: DeploymentState,
    environmentUrl?: string,
    description?: string
  ): Promise<void> {
    if (!this.octokit || !this.environment) {
      core.debug('Skipping deployment status update - no token or environment')
      return
    }

    try {
      // Find the most recent deployment for this environment
      const deployment = await this.findCurrentDeployment()

      if (!deployment) {
        core.warning(
          `No deployment found for environment '${this.environment}' in workflow run ${github.context.runId}`
        )
        return
      }

      // Create deployment status
      await this.octokit.rest.repos.createDeploymentStatus({
        owner: this.owner,
        repo: this.repo,
        deployment_id: deployment.id,
        state,
        environment_url: environmentUrl,
        description: description || '',
        auto_inactive: false
      })

      core.info(
        `Updated deployment ${deployment.id} status to '${state}'${environmentUrl ? ` with URL: ${environmentUrl}` : ''}`
      )
    } catch (error) {
      core.warning(
        `Failed to update deployment status: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Finds the current deployment for this environment and workflow run
   */
  private async findCurrentDeployment(): Promise<{ id: number } | null> {
    if (!this.octokit) return null

    try {
      // Get deployments for this environment
      const { data: deployments } =
        await this.octokit.rest.repos.listDeployments({
          owner: this.owner,
          repo: this.repo,
          environment: this.environment
        })

      if (deployments.length === 0) {
        return null
      }

      // The most recent deployment is the first one (sorted by created_at desc)
      return { id: deployments[0].id }
    } catch (error) {
      core.warning(
        `Failed to find deployment: ${error instanceof Error ? error.message : String(error)}`
      )
      return null
    }
  }
}

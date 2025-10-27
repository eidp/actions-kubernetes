import * as core from '@actions/core'
import {
  getPRNumber,
  getWorkflowRunUrl,
  postOrUpdatePRComment
} from '../../shared/src/pr-comments'

export async function postDeploymentComment(
  token: string,
  success: boolean,
  data: {
    tenantName: string
    namespace: string
    ciPrefix: string
    previewUrl: string
    gitBranch: string
    errorMessage?: string
  }
): Promise<void> {
  const prNumber = getPRNumber()
  if (!prNumber) {
    core.debug('No PR context found, skipping PR comment')
    return
  }

  const marker = `<!-- preview-deployment-status: pr-${prNumber} -->`
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const workflowUrl = getWorkflowRunUrl()

  let body: string

  if (success) {
    const urlSection = data.previewUrl
      ? `### 🌐 Preview URL\n**[${data.previewUrl}](${data.previewUrl})**`
      : `### ℹ️ Preview URL\nNot publicly exposed`

    body = `## ✅ Preview deployment ready

| Field | Value |
|-------|-------|
| Tenant | ${data.tenantName} |
| Namespace | ${data.namespace} |
| CI Prefix | ${data.ciPrefix} |
| Git Branch | ${data.gitBranch} |

${urlSection}

[View workflow run](${workflowUrl})

---
*Deployed at ${timestamp} UTC*`
  } else {
    body = `## ❌ Preview Deployment Failed

${data.errorMessage || 'An unexpected error occurred'}

[View workflow run](${workflowUrl})

---
*Failed at ${timestamp} UTC*`
  }

  await postOrUpdatePRComment(token, prNumber, body, marker)
}

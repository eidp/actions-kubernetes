import * as core from '@actions/core'
import {
  getWorkflowRunUrl,
  postOrUpdatePRComment,
  checkIfPROpen
} from '../../shared/src/pr-comments'

export async function postTeardownComment(
  token: string,
  reference: string,
  wasTimeoutTriggered: boolean,
  age?: string
): Promise<void> {
  // Only comment if reference is a PR number
  const prNumber = parseInt(reference, 10)
  if (isNaN(prNumber)) {
    core.debug(
      `Reference '${reference}' is not a PR number, skipping PR comment`
    )
    return
  }

  // Check if PR exists and is open
  const isOpen = await checkIfPROpen(token, prNumber)
  if (!isOpen) {
    core.debug(`PR #${prNumber} is closed or not found, skipping PR comment`)
    return
  }

  const marker = `<!-- preview-teardown-status: pr-${prNumber} -->`
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const workflowUrl = getWorkflowRunUrl()

  let body: string

  if (wasTimeoutTriggered) {
    body = `## 🗑️ Preview environment destroyed

Your preview environment was automatically destroyed because the configured timeout has passed.

💡 **Tip:** To keep a preview environment, add the \`keep-preview\` label to your PR.

[View workflow run](${workflowUrl})

---
*Destroyed at ${timestamp} UTC${age ? ` (age: ${age})` : ''}*`
  } else {
    body = `## 🗑️ Preview environment destroyed

Your preview environment has been manually torn down.

[View workflow run](${workflowUrl})

---
*Destroyed at ${timestamp} UTC*`
  }

  await postOrUpdatePRComment(token, prNumber, body, marker)
}

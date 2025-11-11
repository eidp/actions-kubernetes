## 📚 Examples

### Full example workflow with slash commands

```yaml
name: Preview environment

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
  issue_comment:
    types: [created]

permissions:
  contents: read
  actions: read
  pull-requests: write
  issues: write
  id-token: write
  deployments: write
concurrency:
  group: pr-${{ github.event.number || github.event.issue.number }}
  cancel-in-progress: false

jobs:
  deploy-preview:
    if: |
      (github.event_name == 'pull_request' && github.event.action != 'closed') ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request)
    runs-on: ubuntu-latest
    environment: 
      name: pr-${{ github.event.number || github.event.issue.number }}
      url: ${{ steps.verify-preview.outputs.url }}

    steps:
      # When triggered by slash commands (issue_comment), we need to check out the PR branch
      # because issue_comment events run from the default branch (security feature)
      - name: Get PR branch
        if: github.event_name == 'issue_comment'
        uses: xt0rted/pull-request-comment-branch@v3
        id: comment-branch

      - name: Checkout code
        uses: actions/checkout@v5
        with:
          # Use PR branch when triggered by slash command, otherwise use the default ref
          ref: ${{ github.event_name == 'issue_comment' && steps.comment-branch.outputs.head_ref || '' }}

      # This step fetches the semantic version based on the commit history.
      # The same version should be used to tag the Helm chart, in case your repository contains one.
      - name: Fetch commit version
        id: commit-version
        uses: eidp/actions-semver/fetch-commit-version@d4f33761d7dafbeff3241fe8afe927a1d7516703 # v0.4.0
        with:
          workflow-name: build  # The name of the workflow that builds the artifacts Docker container / Helm chart

      - name: Create Kubernetes context
        id: create-context
        uses: eidp/actions-kubernetes/create-context@v0
        with:
          # This references the development cluster. Preview environments are typically deployed to a development cluster.
          cluster: development
          api-server: ${{ vars.K8S_API_SERVER_DEVELOPMENT }}
          certificate-authority-data:
            ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}

      - name: Deploy preview
        id: deploy-preview
        uses: eidp/actions-kubernetes/deploy-preview@v0
        with:
          # This references the GitHub environment for this PR, not the target cluster environment.
          environment: 'pr-${{ github.event.number || github.event.issue.number }}'
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          tenant-name: <<YOUR_TENANT_NAME>>
          chart-version: '${{ steps.commit-version.outputs.version }}'
          reference: ${{ github.event.number || github.event.issue.number }}
          github-token: ${{ github.token }}

      - name: Verify preview deployment
        id: verify-preview
        if: github.event_name != 'issue_comment' || steps.deploy-preview.outputs.namespace != ''
        uses: eidp/actions-kubernetes/verify-up@v0
        with:
          environment: 'pr-${{ github.event.number || github.event.issue.number }}'
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          namespace: ${{ steps.deploy-preview.outputs.namespace }}
          flux-resource: 'helmrelease/<<YOUR_HELM_RELEASE_NAME>>' # e.g. helmrelease/my-app
          chart-version: '${{ steps.commit-version.outputs.version }}'
          github-token: ${{ github.token }}

  teardown:
    # Run when: PR is closed, issue comment on PR, or PR has 'dependencies' label
    if: |
      (github.event_name == 'pull_request' && github.event.action == 'closed') ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request) ||
      (github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'dependencies'))
    runs-on: ubuntu-latest
    steps:
      - name: Create Kubernetes context
        id: create-context
        uses: eidp/actions-kubernetes/create-context@798805fe9cbaa8c73ebc4a7d77b10e7c6f49ffd4
        with:
          cluster: development
          api-server: {{ '${{ vars.K8S_API_SERVER_DEVELOPMENT }}' }}
          certificate-authority-data:
            {{ '${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}' }}

      - name: Teardown preview
        uses: eidp/actions-kubernetes/teardown-preview@798805fe9cbaa8c73ebc4a7d77b10e7c6f49ffd4
        with:
          kubernetes-context: {{ '${{ steps.create-context.outputs.context-name }}' }}
          reference: {{ '${{ github.event.number || github.event.issue.number }}' }}
          github-token: {{ '${{ github.token }}' }}
```

Replace `<<YOUR_TENANT_NAME>>` with your tenant name on your EIDP instance 
and `<<YOUR_HELM_RELEASE_NAME>>` with the name of the Helm release that deploys your application.

## Slash command integration

This action has slash command support built in. When called from an `issue_comment` event, it automatically:

1. Detects the `/deploy` command in PR comments
2. Checks that the commenter has write access to the repository
3. Adds emoji reactions (👀 for processing, ✅ for success, ❌ for failure)
4. Executes the deployment

**Requirements:**
- Your workflow must include both `pull_request` and `issue_comment` triggers
- Your workflow must have the required permissions: `contents:read`, `pull-requests:write`, `issues:write`
- Your workflow must check out the PR branch when triggered by slash commands (see example above)
- The commenter must have write or admin access to the repository

### Why checkout the PR branch?

When workflows are triggered by `issue_comment` events, GitHub runs them from the **default branch** (usually `main`) for security reasons. This means without the checkout step, your workflow would deploy code from `main` instead of the PR's code.

The `xt0rted/pull-request-comment-branch` action solves this by fetching the PR's branch reference from the GitHub API, allowing you to check out and deploy the actual PR code. This is the standard pattern used across the GitHub Actions ecosystem for slash commands.

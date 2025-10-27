## 📚 Examples

### Full example workflow with slash commands

```yaml
name: Preview Environment

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
  issue_comment:
    types: [created]

concurrency:
  group: pr-${{ github.event.number || github.event.issue.number }}
  cancel-in-progress: ${{ github.event.action != 'closed' }}

jobs:
  preview:
    # Only run on PR events or PR comments (not issue comments)
    if: (github.event_name == 'pull_request') || (github.event_name == 'issue_comment' && github.event.issue.pull_request)
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
      id-token: write
    environment:
      name: pr-${{ github.event.number || github.event.issue.number }}
      url: ${{ steps.deploy-preview.outputs.preview-url }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v5

      # This step generates a semantic version based on the commit history.
      # The same version should be used to tag the Helm chart, in case your repository contains one.
      - name: Generate version
        id: generate
        uses: eidp/actions-semver/generate-version@v0

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
        if: github.event.action != 'closed'
        uses: eidp/actions-kubernetes/deploy-preview@v0
        with:
          # This references the github environment for this PR, not the target cluster environment.
          environment: 'pr-${{ github.event.number || github.event.issue.number }}'
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          chart-version: '${{ steps.generate.outputs.version }}'
          tenant-name: actions-kubernetes
          reference: ${{ github.event.number || github.event.issue.number }}
          timeout: 10m

      - name: Verify preview deployment
        if: github.event.action != 'closed'
        uses: eidp/actions-kubernetes/verify-up@v0
        with:
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          namespace: ${{ steps.deploy-preview.outputs.namespace }}
          chart-version: '${{ steps.generate.outputs.version }}'
          timeout: 10m

      - name: Teardown preview
        if: github.event.action == 'closed' || github.event_name == 'issue_comment'
        uses: eidp/actions-kubernetes/teardown-preview@v0
        with:
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          reference: ${{ github.event.number || github.event.issue.number }}
          wait-for-deletion: true
          timeout: 10m
```

## Slash command integration

This action has slash command support built in. When called from an `issue_comment` event, it automatically:

1. Detects the `/deploy` command in PR comments
2. Checks that the commenter has write access to the repository
3. Adds emoji reactions (👀 for processing, ✅ for success, ❌ for failure)
4. Executes the deployment

**Requirements:**
- Your workflow must include both `pull_request` and `issue_comment` triggers
- Your workflow must have the required permissions: `contents:read`, `pull-requests:write`, `issues:write`
- The commenter must have write or admin access to the repository

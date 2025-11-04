## 📚 Examples

### Targeted cleanup on PR close

This example is a standalone teardown workflow. For a complete workflow that handles both deploy and teardown with slash commands, see the [deploy-preview examples](../deploy-preview/EXAMPLES.md).

```yaml
name: 'Cleanup Preview on PR Close'

on:
  pull_request:
    types: [closed]
  issue_comment:
    types: [created]

concurrency:
  group: pr-${{ github.event.number || github.event.issue.number }}
  cancel-in-progress: false

jobs:
  cleanup:
    if: (github.event_name == 'pull_request') || (github.event_name == 'issue_comment' && github.event.issue.pull_request)
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      pull-requests: write
      issues: write

    steps:
      - name: Create Kubernetes context
        id: create-context
        uses: eidp/actions-kubernetes/create-context@v0
        with:
          cluster: development
          api-server: ${{ vars.K8S_API_SERVER_DEVELOPMENT }}
          certificate-authority-data:
            ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}

      - name: Teardown preview
        uses: eidp/actions-kubernetes/teardown-preview@v0
        with:
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          reference: ${{ github.event.number || github.event.issue.number }}
          wait-for-deletion: true
          github-token: ${{ github.token }}
```

### Bulk cleanup with age filter

Scheduled job to clean up old preview deployments:

```yaml
name: 'Cleanup Stale Previews'

on:
  schedule:
    - cron: '0 2 * * *' # Daily at 2 AM UTC
  workflow_dispatch:

jobs:
  cleanup-stale:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      pull-requests: read

    steps:
      - name: Create Kubernetes context
        id: create-context
        uses: eidp/actions-kubernetes/create-context@v0
        with:
          environment: development
          api-server: ${{ vars.K8S_API_SERVER_DEVELOPMENT }}
          certificate-authority-data:
            ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}

      - name: Cleanup previews older than 7 days
        uses: eidp/actions-kubernetes/teardown-preview@v0
        with:
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          github-token: ${{ github.token }}
          max-age: 7d
```

### Dry run mode

Test what would be deleted without actually deleting:

```yaml
name: 'Preview Cleanup Dry Run'

on:
  workflow_dispatch:

jobs:
  dry-run:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      pull-requests: read

    steps:
      - name: Create Kubernetes context
        id: create-context
        uses: eidp/actions-kubernetes/create-context@v0
        with:
          environment: development
          api-server: ${{ vars.K8S_API_SERVER_DEVELOPMENT }}
          certificate-authority-data:
            ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}

      - name: Dry run cleanup
        uses: eidp/actions-kubernetes/teardown-preview@v0
        with:
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          dry-run: true
```

### Cleanup all previews (no age filter)

Clean up all preview deployments, respecting protection labels:

```yaml
name: 'Cleanup All Previews'

on:
  workflow_dispatch:

jobs:
  cleanup-all:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      pull-requests: read

    steps:
      - name: Create Kubernetes context
        id: create-context
        uses: eidp/actions-kubernetes/create-context@v0
        with:
          environment: development
          api-server: ${{ vars.K8S_API_SERVER_DEVELOPMENT }}
          certificate-authority-data:
            ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}

      - name: Cleanup all previews
        uses: eidp/actions-kubernetes/teardown-preview@v0
        with:
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          github-token: ${{ github.token }}
```

## Protection with labels

PRs with the `keep-preview` label will be protected from deletion. This is always checked when GITHUB_TOKEN is available:

```yaml
# Add this label to a PR to protect its preview:
# Labels: keep-preview
```

The action will skip any preview deployment associated with a PR that has this label, regardless of age or other filters.

## Important notes

- **Permissions**: Workflows need `contents:read`, `pull-requests:write`, and `issues:write` permissions for PR comments and label checking
- **Context**: Must use the same Kubernetes context that was used to deploy the preview
- **CI prefix length**: Must match the value used in deploy-preview (default: 16)
- **Wait for deletion**: Enable this when you need to ensure resources are fully removed before workflow completes

## Slash command integration

This action has slash command support built in. When called from an `issue_comment` event, it automatically:

1. Detects the `/teardown` command in PR comments
2. Checks that the commenter has write access to the repository
3. Adds emoji reactions (👀 for processing, ✅ for success, ❌ for failure)
4. Executes the teardown

**Requirements:**
- Your workflow must include both `pull_request` and `issue_comment` triggers
- Your workflow must have the required permissions: `contents:read`, `pull-requests:write`, `issues:write`
- The commenter must have write or admin access to the repository

For a complete unified workflow example that handles both deploy and teardown with slash commands, see the [deploy-preview examples](../deploy-preview/EXAMPLES.md).

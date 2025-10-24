## 📚 Examples

### Targeted Cleanup on PR Close

Clean up a specific preview when a pull request is closed:

```yaml
name: 'Cleanup Preview on PR Close'

on:
  pull_request:
    types: [closed]

jobs:
  cleanup:
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

      - name: Teardown preview
        uses: eidp/actions-kubernetes/teardown-preview@v0
        with:
          kubernetes-context: ${{ steps.create-context.outputs.context-name }}
          reference: ${{ github.event.number }}
          wait-for-deletion: true
          timeout: 10m
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Bulk Cleanup with Age Filter

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
          max-age: 7d
          timeout: 15m
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Dry Run Mode

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
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Cleanup All Previews (No Age Filter)

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
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Protection with Labels

PRs with the `keep-preview` label will be protected from deletion. This is always checked when GITHUB_TOKEN is available:

```yaml
# Add this label to a PR to protect its preview:
# Labels: keep-preview
```

The action will skip any preview deployment associated with a PR that has this label, regardless of age or other filters.

## Important Notes

- **GITHUB_TOKEN**: Always provide `GITHUB_TOKEN` in the environment for protection label checking to work
- **Permissions**: The workflow needs `pull-requests: read` permission to check PR labels
- **Context**: Must use the same Kubernetes context that was used to deploy the preview
- **CI Prefix Length**: Must match the value used in deploy-preview (default: 16)
- **Wait for Deletion**: Enable this when you need to ensure resources are fully removed before workflow completes

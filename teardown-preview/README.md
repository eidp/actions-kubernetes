<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Teardown Preview (Action)

Teardown preview environments deployed by the deploy-preview action.

This action discovers and deletes FluxCD OCIRepository and Kustomization resources that were created
for preview deployments. FluxCD's pruning will automatically cascade the deletion to namespaces and
application resources.

A kubernetes context must already be configured prior to using this action.
Checkout the [Create Kubernetes context](../create-context) action to create and configure a kubernetes context.

This action supports both targeted cleanup (specific preview) and bulk cleanup (multiple previews).
It can be used in PR close workflows or scheduled cleanup jobs.

Protection checking is always enabled - PRs with the "keep-preview" label will be skipped. Requires GITHUB_TOKEN.

## 🔧 Inputs

|Name                 |Description                                                                                                               |Required|Default |
|---------------------|--------------------------------------------------------------------------------------------------------------------------|--------|--------|
|`kubernetes-context` |The name of the Kubernetes context to use for teardown.                                                                   |Yes     |``      |
|`reference`          |Target specific preview by reference (PR number, commit SHA, branch). If not provided, discovers all preview deployments. |No      |``      |
|`ci-prefix-length`   |The number of characters from the reference to include in the CI prefix. Must match the value used in deploy-preview.     |No      |`16`    |
|`wait-for-deletion`  |Wait for resources to be fully deleted before completing.                                                                 |No      |`false` |
|`timeout`            |Timeout for wait-for-deletion.                                                                                            |No      |`5m`    |
|`dry-run`            |Report what would be deleted without actually deleting.                                                                   |No      |`false` |
|`max-age`            |Maximum age before deletion (e.g., 7d, 48h). Only used for bulk cleanup when reference is not provided.                   |No      |``      |
|`github-token`       |GitHub token for posting PR comments. Requires pull-requests:write permission.                                            |No      |``      |

## 📤 Outputs

|Name                |Description                                             |
|--------------------|--------------------------------------------------------|
|`deleted-count`     |Number of preview deployments deleted.                  |
|`deleted-resources` |JSON array of deleted resource names.                   |
|`skipped-count`     |Number of previews skipped (protected or already gone). |
|`skipped-resources` |JSON array of skipped resource names with reasons.      |

## 🚀 Usage

```yaml
- name: Teardown Preview
  uses: eidp/actions-kubernetes/teardown-preview@v0
  with:
    # your inputs here
```


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
          cluster: development
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

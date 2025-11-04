<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Teardown Preview (Action)

Teardown preview environments on an EIDP instance deployed by the deploy-preview action.

This action discovers and **deletes** the Kubernetes resources that were created for the preview deployment.
FluxCD's pruning will automatically cascade the deletion to application resources and other related resources.

A kubernetes context must already be configured prior to using this action.
Checkout the [Create Kubernetes context](../create-context) action to create and configure a kubernetes context.

This action supports both targeted cleanup (specific preview) and bulk cleanup (multiple previews).
It can be used in PR close workflows or scheduled cleanup jobs.

Protection checking is always enabled - PRs with the "keep-preview" label will be skipped. Requires GITHUB_TOKEN.

## 🔧 Inputs

|Name                 |Description                                                                                                                                                   |Required|Default |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|--------|
|`kubernetes-context` |The name of the Kubernetes context to use for teardown.                                                                                                       |Yes     |``      |
|`reference`          |Target specific preview by reference (PR number, commit SHA, branch). If not provided, discovers all preview deployments.                                     |No      |``      |
|`ci-prefix-length`   |The number of characters from the reference to include in the CI prefix. Must match the value used in deploy-preview.                                         |No      |`16`    |
|`wait-for-deletion`  |Wait for resources to be fully deleted before completing.                                                                                                     |No      |`false` |
|`timeout`            |The time to wait for the deletion to be completed successfully. After the timeout is reached, the job will fail. Example timeout values: 3m, 90s, 2.5m, 2m30s |No      |`5m`    |
|`dry-run`            |Report what would be deleted without actually deleting.                                                                                                       |No      |`false` |
|`max-age`            |Maximum age before deletion (e.g., 7d, 48h). Only used for bulk cleanup when reference is not provided.                                                       |No      |``      |
|`github-token`       |GitHub token for authentication. Uses GITHUB_TOKEN if not provided. Required permissions: contents:read, pull-requests:write, issues:write.                   |No      |``      |

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

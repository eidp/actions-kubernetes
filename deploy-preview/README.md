<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Deploy Preview (Action)

Deploy a preview environment to Kubernetes using FluxCD OCIRepository and Kustomization resources.
This action creates uniquely-named preview deployments that can coexist for multiple concurrent branches/PRs.

Given an existing tenant definition, this action will roll out an isolated preview deployment of that tenant and its accompanying application(s).

A kubernetes context must already be configured prior to using this action.
Checkout the [Create Kubernetes context](../create-context) action to create and configure a kubernetes context.

This action is intended to be used in pull request workflows to provide preview environments for testing changes before merging.
After the pull request is closed/merged, the preview deployment can be cleaned up using the [Teardown Preview](../teardown-preview) action.

To show the preview deployment URL in the pull request, use the `preview-url` output of this action and add it to the `environment` key of the workflow job.

```yaml
environment:
  name: pr-${{ github.event.number }}
  url: ${{ steps.deploy-preview.outputs.preview-url }}
```

To prevent multiple preview deployments for the same PR, it is recommended to add a workflow-level or job-level concurrency group:

```yaml
  concurrency:
    group: pr-${{ github.event.number }}
    cancel-in-progress: false
```

## 🔧 Inputs

|Name                 |Description                                                                                                                                                                                                                                        |Required|Default|
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|-------|
|`environment`        |The github environment used to deploy to (e.g. `pr-${{ github.event.pr }}`).                                                                                                                                                                  |Yes     |``     |
|`kubernetes-context` |The name of the Kubernetes context to use for deployment.                                                                                                                                                                                          |Yes     |``     |
|`tenant-name`        |The tenant name used to identify the tenant definition in the OCI repository.                                                                                                                                                                      |Yes     |``     |
|`reference`          |A reference used to uniquely identify this preview environment. Among other things, it is used to generate a resource name prefix. Typically this would be the Pull Request number (`github.pr.number`) or branch reference (`github.branch_ref`). |Yes     |       |
|`ci-prefix-length`   |The number of characters from the reference to include in the CI prefix. Should be sufficient to ensure uniqueness while keeping resource names within Kubernetes limits. Can be max 24 characters.                                                |No      |`16`   |
|`chart-version`      |Optional chart version override.                                                                                                                                                                                                                   |No      |``     |
|`timeout`            |The time to wait for the deployment to be completed successfully.                                                                                                                                                                                  |No      |`5m`   |
|`ingress-selector`   |Label selector to identify the ingress resource for preview URL discovery (e.g. app=my-app). Required if multiple ingresses exist in the namespace.                                                                                                |No      |``     |
|`github-token`       |GitHub token for authentication. Uses GITHUB_TOKEN if not provided. Required permissions: contents:read, pull-requests:write, issues:write.                                                                                                        |No      |``     |

## 📤 Outputs

|Name                  |Description                                                 |
|----------------------|------------------------------------------------------------|
|`oci-repository-name` |The name of the created OCIRepository resource.             |
|`kustomization-name`  |The name of the created Kustomization resource.             |
|`namespace`           |The target namespace for the deployment.                    |
|`ci-prefix`           |The generated CI prefix used for resource naming.           |
|`preview-url`         |The discovered preview deployment URL (empty if not found). |

## 🚀 Usage

```yaml
- name: Deploy Preview
  uses: eidp/actions-kubernetes/deploy-preview@v0
  with:
    # your inputs here
```


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
  cancel-in-progress: false

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
      # When triggered by slash commands (issue_comment), we need to checkout the PR branch
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
          tenant-name: <<YOUR_TENANT_NAME>>
          chart-version: '${{ steps.generate.outputs.version }}'
          reference: ${{ github.event.number || github.event.issue.number }}
          github-token: ${{ github.token }}
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
          github-token: ${{ github.token }}
          timeout: 10m
```

Replace `<<YOUR_TENANT_NAME>>` with your tenant name on your EIDP instance.

## Slash command integration

This action has slash command support built in. When called from an `issue_comment` event, it automatically:

1. Detects the `/deploy` command in PR comments
2. Checks that the commenter has write access to the repository
3. Adds emoji reactions (👀 for processing, ✅ for success, ❌ for failure)
4. Executes the deployment

**Requirements:**
- Your workflow must include both `pull_request` and `issue_comment` triggers
- Your workflow must have the required permissions: `contents:read`, `pull-requests:write`, `issues:write`
- Your workflow must checkout the PR branch when triggered by slash commands (see example above)
- The commenter must have write or admin access to the repository

### Why checkout the PR branch?

When workflows are triggered by `issue_comment` events, GitHub runs them from the **default branch** (usually `main`) for security reasons. This means without the checkout step, your workflow would deploy code from `main` instead of the PR's code.

The `xt0rted/pull-request-comment-branch` action solves this by fetching the PR's branch reference from the GitHub API, allowing you to checkout and deploy the actual PR code. This is the standard pattern used across the GitHub Actions ecosystem for slash commands.

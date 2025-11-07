<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Deploy Preview (Action)

Deploy a preview (aka ephemeral) environment on an EIDP instance.
This action creates uniquely-named preview deployments that can coexist for multiple concurrent branches/PRs.

In order to use this action, you need an existing EIDP instance and a tenant on that EIDP instance.
Given the existing tenant definition, this action will roll out an isolated preview deployment of that tenant and its accompanying application(s).
The action deploys resources using FluxCD, which reconciles the Kubernetes manifests from your repository.
Your repository must contain Kubernetes manifests, specifically a HelmRelease resource that will be deployed by FluxCD.
These manifests must live in the `/manifests/` folder in the root of your repository.

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
|`github-token`       |GitHub token for authentication. Uses GITHUB_TOKEN if not provided. Required permissions: contents:read, pull-requests:write, issues:write, deployments: write.                                                                                    |No      |``     |

## 📤 Outputs

|Name                  |Description                                       |
|----------------------|--------------------------------------------------|
|`oci-repository-name` |The name of the created OCIRepository resource.   |
|`kustomization-name`  |The name of the created Kustomization resource.   |
|`namespace`           |The target namespace for the deployment.          |
|`ci-prefix`           |The generated CI prefix used for resource naming. |

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
    # Only run on PR events or PR comments (not issue comments)
    if: (github.event_name == 'pull_request') || (github.event_name == 'issue_comment' && github.event.issue.pull_request)
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
        if: github.event.action != 'closed'
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
        if: github.event.action != 'closed' && (github.event_name != 'issue_comment' || steps.deploy-preview.outputs.namespace != '')
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

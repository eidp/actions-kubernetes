<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Deploy Preview (Action)

Deploy a preview environment to Kubernetes using FluxCD OCIRepository and Kustomization resources.
This action creates uniquely-named preview deployments that can coexist for multiple concurrent branches/PRs.

Given an existing tenant definition, this action will roll out an isolated preview deployment of that tenant and its accompanying application(s).

A kubernetes context must already be configured prior to using this action.
Checkout the [Create Kubernetes context](../create-context) action to create and configure a kubernetes context.

This action is intended to be used in pull request workflows to provide preview environments for testing changes before merging.
After the pull request is closed/merged, the preview deployment can be cleaned up using the [Teardown Preview](../teardown-preview) action.

The following triggers are recommended for pull request workflows:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```  

To show the preview deployment URL in the pull request, use the `preview-url` output of this action and add it to the `environment` key of the workflow job.

```yaml
environment:
  name: pr-\$\{\{ github.event.number \}\}
  url: \$\{\{ steps.deploy-preview.outputs.preview-url \}\}
```

To prevent multiple preview deployments for the same PR, it is recommended to add a workflow-level or job-level concurrency group:

```yaml
  concurrency:
    group: pr-\$\{\{ github.event.number \}\}
    cancel-in-progress: false
```

## 🔧 Inputs

|          Name         |                                                                                                                    Description                                                                                                                   |Required|           Default           |
|-----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|-----------------------------|
|  `kubernetes-context` |                                                                                             The name of the Kubernetes context to use for deployment.                                                                                            |   Yes  |              ``             |
|     `tenant-name`     |                                                                                   The tenant name used to identify the tenant definition in the OCI repository.                                                                                  |   Yes  |              ``             |
|      `reference`      |A reference used to uniquely identify this preview environment. Among other things, it is used to generate a resource name prefix. Typically this would be the Pull Request number (`github.pr.number`) or branch reference (`github.branch_ref`).|   Yes  |                             |
|   `ci-prefix-length`  |                                                                                     The number of characters from the reference to include in the CI prefix.                                                                                     |   No   |             `16`            |
|`oci-repository-secret`|                                                                                         The name of the secret for authenticating to the OCI repository.                                                                                         |   No   |`eidp-harbor-pull-credential`|
|    `chart-version`    |                                                                                                         Optional chart version override.                                                                                                         |   No   |              ``             |
|       `timeout`       |                                                                                         The time to wait for the deployment to be completed successfully.                                                                                        |   No   |             `5m`            |

## 📤 Outputs

|         Name        |                        Description                        |
|---------------------|-----------------------------------------------------------|
|`oci-repository-name`|      The name of the created OCIRepository resource.      |
| `kustomization-name`|      The name of the created Kustomization resource.      |
|     `namespace`     |          The target namespace for the deployment.         |
|     `ci-prefix`     |     The generated CI prefix used for resource naming.     |
|    `preview-url`    |The discovered preview deployment URL (empty if not found).|

## 🚀 Usage

```yaml
- name: Deploy Preview
  uses: eidp/actions-kubernetes/deploy-preview@v0
  with:
    # your inputs here
```

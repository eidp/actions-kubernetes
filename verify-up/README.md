<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Verify Up (Action)

This actions verifies whether the deployment specified in by the provided inputs is up and running.
It checks the status of the deployment in the specified Kubernetes namespace.

A kubernetes context must already be configured prior to using this action.
Checkout the [Create Kubernetes context](./create-context) action to create and configure a kubernetes context.

## 🔧 Inputs

|Name                  |Description                                                                                                                                                                                                                                                                                                                                                                                            |Required|Default|
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|-------|
|`kubernetes-context`  |The name of the Kubernetes context to use for verification.                                                                                                                                                                                                                                                                                                                                            |Yes     |``     |
|`namespace`           |The Kubernetes namespace where the deployment is located.                                                                                                                                                                                                                                                                                                                                              |Yes     |``     |
|`flux-resource`       |The Flux resource path of the deployment to verify (e.g. helmreleases/my-release or kustomization/my-release). If not provided, the action will attempt to verify all deployments in the specified namespace.a                                                                                                                                                                                         |No      |``     |
|`chart-version`       |Specify the chart-version input in case you want to verify if a specific version of a Helm chart is up. When used with `flux-resource`, verifies that specific resource has the version. When used without `flux-resource`, verifies at least one HelmRelease in the namespace has the version.                                                                                                        |No      |``     |
|`timeout`             |The time to wait for the deployment to be completed successfully. After the timeout is reached, the job will fail.                                                                                                                                                                                                                                                                                     |No      |`3m`   |
|`pod-selector`        |For namespaces containing multiple deployments, you can specify a pod selector to ensure that only pods belonging to this deployment are evaluated for successful deployment. The pod selector uses label selectors, such as app=my-app. For advanced usage, refer to the Kubernetes documentation: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/#list-and-watch-filtering |No      |``     |
|`important-workloads` |Space-separated list of resources for which logs should be displayed during the verify step, such as `deploy/my-server` or `job/my-job`.                                                                                                                                                                                                                                                               |No      |``     |

## 📤 Outputs

_None_

## 🚀 Usage

```yaml
- name: Verify Up
  uses: eidp/actions-kubernetes/verify-up@v0
  with:
    # your inputs here
```

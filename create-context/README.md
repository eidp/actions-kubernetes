<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Create Kubernetes context (Action)

Create a kubernetes context. The context will be created using the provided API server URL and certificate authority data.
For authentication, the action uses a [GitHub OIDC token](https://docs.github.com/en/actions/concepts/security/openid-connect#overview-of-openid-connect-oidc) to request a short-lived token from GitHub's OIDC provider.
This action requires that your Kubernetes cluster is configured to trust tokens issued by GitHub's OIDC provider.
In order to request a token, this action requires the following permissions:
```yaml permissions:
  id-token: write
  contents: read
```

## 🔧 Inputs

|            Name            |                                    Description                                   |Required|   Default   |
|----------------------------|----------------------------------------------------------------------------------|--------|-------------|
|        `environment`       |The environment to create the context for (e.g. development, staging, production).|   No   |`development`|
|        `api-server`        |                  The API server URL for the Kubernetes cluster.                  |   Yes  |      ``     |
|`certificate-authority-data`|     The base64 encoded certificate authority data for the Kubernetes cluster.    |   Yes  |      ``     |
|      `kubectl-version`     |                          The version of kubectl to use.                          |   No   |   `latest`  |

## 📤 Outputs

|     Name     |                Description                |
|--------------|-------------------------------------------|
|`context-name`|The name of the created Kubernetes context.|

## 🚀 Usage

```yaml
- name: Create Kubernetes context
  uses: eidp/actions-kubernetes/create-context@v0
  with:
    # your inputs here
```

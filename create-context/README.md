<!-- NOTE: This file's contents are automatically generated. Do not edit manually. -->
# Create Kubernetes context (Action)

Create a kubernetes context. The context will be created using the provided API server URL and certificate authority data.

For authentication, the action uses a [GitHub OIDC token](https://docs.github.com/en/actions/concepts/security/openid-connect#overview-of-openid-connect-oidc)
which is exchanged with Keycloak to obtain a Kubernetes access token.

In order to request a token, this action requires the following permissions:

```yaml
permissions:
  id-token: write
  contents: read
```

## 🔧 Inputs

|Name                           |Description                                                                         |Required|Default       |
|-------------------------------|------------------------------------------------------------------------------------|--------|--------------|
|`cluster`                      |The cluster to create the context for (e.g. development, staging, production).      |No      |`development` |
|`api-server`                   |The API server URL for the Kubernetes cluster.                                      |Yes     |``            |
|`certificate-authority-data`   |The base64 encoded certificate authority data for the Kubernetes cluster.           |Yes     |``            |
|`keycloak-url`                 |The Keycloak realm URL for token exchange (e.g. https://login.eidp.io/realms/eidp). |Yes     |``            |
|`token-exchange-client-id`     |The client ID for Keycloak token exchange.                                          |Yes     |``            |
|`token-exchange-client-secret` |The client secret for Keycloak token exchange.                                      |Yes     |``            |
|`print-jwt-claims`             |Print the JWT claims from the OIDC token for debugging purposes.                    |No      |`false`       |

## 📤 Outputs

|Name           |Description                                 |
|---------------|--------------------------------------------|
|`context-name` |The name of the created Kubernetes context. |

## 🚀 Usage

```yaml
- name: Create Kubernetes context
  uses: eidp/actions-kubernetes/create-context@v0
  with:
    # your inputs here
```


## 📚 Examples

### Basic Usage

```yaml
name: 'Deploy to Kubernetes'

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v5

      - name: Create Kubernetes context
        id: create-context
        uses: eidp/actions-kubernetes/create-context@v0
        with:
          cluster: production
          api-server: ${{ vars.K8S_API_SERVER_PRODUCTION }}
          certificate-authority-data:
            ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_PRODUCTION }}

      - name: Deploy application
        run: |
          kubectl apply -f manifests/
```

### With JWT Claims Debugging

```yaml
steps:
  - name: Create Kubernetes context (with debug info)
    uses: eidp/actions-kubernetes/create-context@v0
    with:
      cluster: development
      api-server: ${{ vars.K8S_API_SERVER_DEVELOPMENT }}
      certificate-authority-data:
        ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}
      print-jwt-claims: 'true'
```

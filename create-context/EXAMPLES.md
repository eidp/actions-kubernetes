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

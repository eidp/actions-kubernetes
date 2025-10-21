## 📚 Examples

### Full example workflow

```yaml
name: 'Deploy Preview on PR'

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    environment:
      name: pr-${{ github.event.number }}
      url: ${{ steps.deploy-preview-happy.outputs.preview-url }}
    concurrency:
      group: pr-${{ github.event.number }}
      cancel-in-progress: false

    steps:
    - name: Checkout code
      uses: actions/checkout@v5

    # This step generates a semantic version based on the commit history.
    # The same version should be used to tag the Helm chart, in case you are publishing it as part of your CI/CD pipeline.
    - name: Generate version
      id: generate
      uses: eidp/actions-semver/generate-version@v0

    - name: Create Kubernetes context
      id: create-context
      uses: eidp/actions-kubernetes/create-context@v0
      with:
        # This references the development cluster. Preview environments are typically deployed to a development cluster.
        environment: development
        api-server: ${{ vars.K8S_API_SERVER_DEVELOPMENT }}
        certificate-authority-data: ${{ secrets.K8S_CERTIFICATE_AUTHORITY_DATA_DEVELOPMENT }}

    - name: "Deploy Preview"
      id: deploy-preview-happy
      uses: eidp/actions-kubernetes/deploy-preview@v0
      with:
        # This references the github environment for this PR, not the target cluster environment.
        environment: 'pr-${{ github.event.number }}'
        kubernetes-context: ${{ steps.create-context.outputs.context-name }}
        chart-version: '${{ steps.generate.outputs.version }}'
        tenant-name: actions-kubernetes
        reference: ${{ github.event.number || github.ref_name }}
        timeout: 10m
```
export interface FluxResourceSpec {
  group: string
  version: string
  plural: string
  name: string
  kind: string
}

export function parseFluxResourceInput(fluxResource: string): FluxResourceSpec {
  const parts = fluxResource.split('/')
  if (parts.length !== 2) {
    throw new Error(
      `Invalid flux-resource format: ${fluxResource}. Expected format: <type>/<name> (e.g., helmreleases/my-release or ks/my-kustomization)`
    )
  }

  const [resourceType, name] = parts

  const resourceMap: Record<
    string,
    { group: string; version: string; plural: string; kind: string }
  > = {
    helmreleases: {
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      plural: 'helmreleases',
      kind: 'HelmRelease'
    },
    hr: {
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      plural: 'helmreleases',
      kind: 'HelmRelease'
    },
    kustomizations: {
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      plural: 'kustomizations',
      kind: 'Kustomization'
    },
    ks: {
      group: 'kustomize.toolkit.fluxcd.io',
      version: 'v1',
      plural: 'kustomizations',
      kind: 'Kustomization'
    }
  }

  const spec = resourceMap[resourceType.toLowerCase()]
  if (!spec) {
    throw new Error(
      `Unsupported flux resource type: ${resourceType}. Supported types: helmreleases (hr), kustomizations (ks)`
    )
  }

  return {
    ...spec,
    name
  }
}

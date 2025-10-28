import { parseFluxResourceInput } from '../src/flux-resource-spec'

describe('flux-resources', () => {
  describe('parseFluxResourceInput', () => {
    it('should parse helmreleases resource correctly', () => {
      const result = parseFluxResourceInput('helmreleases/my-release')
      expect(result).toEqual({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        plural: 'helmreleases',
        name: 'my-release',
        kind: 'HelmRelease'
      })
    })

    it('should parse kustomizations resource correctly', () => {
      const result = parseFluxResourceInput('kustomizations/my-kustomization')
      expect(result).toEqual({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        plural: 'kustomizations',
        name: 'my-kustomization',
        kind: 'Kustomization'
      })
    })

    it('should parse short form "hr" for helmreleases', () => {
      const result = parseFluxResourceInput('hr/my-release')
      expect(result).toEqual({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        plural: 'helmreleases',
        name: 'my-release',
        kind: 'HelmRelease'
      })
    })

    it('should parse short form "ks" for kustomizations', () => {
      const result = parseFluxResourceInput('ks/my-kustomization')
      expect(result).toEqual({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        plural: 'kustomizations',
        name: 'my-kustomization',
        kind: 'Kustomization'
      })
    })

    it('should throw error for invalid format', () => {
      expect(() => parseFluxResourceInput('invalid')).toThrow(
        'Invalid flux-resource format'
      )
      expect(() => parseFluxResourceInput('helmreleases')).toThrow(
        'Invalid flux-resource format'
      )
      expect(() => parseFluxResourceInput('')).toThrow(
        'Invalid flux-resource format'
      )
    })

    it('should throw error for unsupported resource type', () => {
      expect(() => parseFluxResourceInput('deployments/my-deploy')).toThrow(
        'Unsupported flux resource type'
      )
      expect(() => parseFluxResourceInput('pods/my-pod')).toThrow(
        'Unsupported flux resource type'
      )
    })

    it('should handle names with hyphens and numbers', () => {
      const result = parseFluxResourceInput(
        'helmreleases/my-app-release-v1-2-3'
      )
      expect(result.name).toBe('my-app-release-v1-2-3')
    })
  })
})

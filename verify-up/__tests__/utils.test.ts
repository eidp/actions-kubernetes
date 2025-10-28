import { HelmRelease, KustomizationResource } from '../src/types'
import {
  isResourceReady,
  getReadyMessage,
  createDeploymentStatus,
  getChartVersion,
  parseTimeout
} from '../src/utils'

describe('utils', () => {
  describe('isResourceReady', () => {
    it('should return true when Ready condition status is True', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'True' }]
        }
      }
      expect(isResourceReady(resource)).toBe(true)
    })

    it('should return false when Ready condition status is False', () => {
      const resource: KustomizationResource = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False' }]
        }
      }
      expect(isResourceReady(resource)).toBe(false)
    })

    it('should return false when Ready condition status is Unknown', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'Unknown' }]
        }
      }
      expect(isResourceReady(resource)).toBe(false)
    })

    it('should return false when no Ready condition exists', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          conditions: [{ type: 'Reconciling', status: 'True' }]
        }
      }
      expect(isResourceReady(resource)).toBe(false)
    })

    it('should return false when status is undefined', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' }
      }
      expect(isResourceReady(resource)).toBe(false)
    })

    it('should return false when conditions array is empty', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: { conditions: [] }
      }
      expect(isResourceReady(resource)).toBe(false)
    })
  })

  describe('getReadyMessage', () => {
    it('should return the Ready condition message when available', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          conditions: [
            { type: 'Ready', status: 'True', message: 'Release reconciled' }
          ]
        }
      }
      expect(getReadyMessage(resource)).toBe('Release reconciled')
    })

    it('should return "Ready" when status is True but no message', () => {
      const resource: KustomizationResource = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'True' }]
        }
      }
      expect(getReadyMessage(resource)).toBe('Ready')
    })

    it('should return "Not Ready" when status is False and no message', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False' }]
        }
      }
      expect(getReadyMessage(resource)).toBe('Not Ready')
    })

    it('should return "Not Ready" when no Ready condition exists', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: { conditions: [] }
      }
      expect(getReadyMessage(resource)).toBe('Not Ready')
    })
  })

  describe('createDeploymentStatus', () => {
    it('should create deployment status for ready HelmRelease', () => {
      const resource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'my-release', namespace: 'default' },
        status: {
          conditions: [
            { type: 'Ready', status: 'True', message: 'Release reconciled' }
          ]
        }
      }
      const status = createDeploymentStatus(resource)
      expect(status).toEqual({
        name: 'my-release',
        type: 'HelmRelease',
        ready: 'True',
        message: 'Release reconciled'
      })
    })

    it('should create deployment status for not ready Kustomization', () => {
      const resource: KustomizationResource = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'my-kustomization', namespace: 'flux-system' },
        status: {
          conditions: [
            { type: 'Ready', status: 'False', message: 'Reconciliation failed' }
          ]
        }
      }
      const status = createDeploymentStatus(resource)
      expect(status).toEqual({
        name: 'my-kustomization',
        type: 'Kustomization',
        ready: 'False',
        message: 'Reconciliation failed'
      })
    })
  })

  describe('getChartVersion', () => {
    it('should return chart version from history', () => {
      const helmRelease: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: {
          history: [{ chartVersion: '1.2.3' }, { chartVersion: '1.2.2' }]
        }
      }
      expect(getChartVersion(helmRelease)).toBe('1.2.3')
    })

    it('should return undefined when no history exists', () => {
      const helmRelease: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: {}
      }
      expect(getChartVersion(helmRelease)).toBeUndefined()
    })

    it('should return undefined when history is empty array', () => {
      const helmRelease: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' },
        status: { history: [] }
      }
      expect(getChartVersion(helmRelease)).toBeUndefined()
    })

    it('should return undefined when status is undefined', () => {
      const helmRelease: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test', namespace: 'default' }
      }
      expect(getChartVersion(helmRelease)).toBeUndefined()
    })
  })

  describe('parseTimeout', () => {
    it('should parse seconds correctly', () => {
      expect(parseTimeout('30s')).toBe(30000)
      expect(parseTimeout('180s')).toBe(180000)
    })

    it('should parse minutes correctly', () => {
      expect(parseTimeout('3m')).toBe(180000)
      expect(parseTimeout('5m')).toBe(300000)
    })

    it('should parse hours correctly', () => {
      expect(parseTimeout('1h')).toBe(3600000)
      expect(parseTimeout('2h')).toBe(7200000)
    })

    it('should throw error for invalid format', () => {
      expect(() => parseTimeout('invalid')).toThrow('Invalid timeout format')
      expect(() => parseTimeout('3')).toThrow('Invalid timeout format')
      expect(() => parseTimeout('3x')).toThrow('Invalid timeout format')
      expect(() => parseTimeout('m3')).toThrow('Invalid timeout format')
    })
  })
})

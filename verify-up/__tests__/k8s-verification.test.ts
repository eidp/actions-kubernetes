import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { verifySpecificResource, discoverURL } from '../src/k8s-verification.js'
import { FluxClient, KubernetesClient } from '@actions-kubernetes/k8s-client'

vi.mock('@actions/core')
vi.mock('@actions-kubernetes/k8s-client')
vi.mock('@actions-kubernetes/shared/time-utils', () => ({
  parseDuration: vi.fn((str: string) => {
    if (str === '3m') return 180000
    if (str === '5m') return 300000
    return 120000
  })
}))

describe('k8s-verification', () => {
  let mockKubeConfig: k8s.KubeConfig

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'startGroup').mockImplementation(() => {})
    vi.spyOn(core, 'endGroup').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})

    mockKubeConfig = {} as k8s.KubeConfig
  })

  describe('verifySpecificResource', () => {
    it('should verify a ready HelmRelease', async () => {
      const mockParseFluxResourceInput = vi.fn().mockReturnValue({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        kind: 'HelmRelease',
        plural: 'helmreleases',
        name: 'my-release'
      })

      const mockWaitForResourceReady = vi.fn().mockResolvedValue({
        ready: true,
        resource: {
          kind: 'HelmRelease',
          metadata: { name: 'my-release' },
          status: {
            conditions: [
              {
                type: 'Ready',
                status: 'True',
                message: 'Release reconciliation succeeded'
              }
            ]
          }
        },
        chartVersion: '1.2.3'
      })

      const mockIsResourceReady = vi.fn().mockReturnValue(true)

      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          parseFluxResourceInput: mockParseFluxResourceInput,
          waitForResourceReady: mockWaitForResourceReady,
          isResourceReady: mockIsResourceReady
        } as unknown as FluxClient
      })

      const result = await verifySpecificResource(
        mockKubeConfig,
        'test-namespace',
        'helmreleases/my-release',
        '1.2.3',
        '3m'
      )

      expect(result).toEqual([
        {
          name: 'my-release',
          type: 'HelmRelease',
          ready: 'True',
          message: 'Release reconciliation succeeded'
        }
      ])

      expect(mockParseFluxResourceInput).toHaveBeenCalledWith(
        'helmreleases/my-release'
      )
      expect(mockWaitForResourceReady).toHaveBeenCalledWith(
        'test-namespace',
        {
          group: 'helm.toolkit.fluxcd.io',
          version: 'v2',
          kind: 'HelmRelease',
          plural: 'helmreleases',
          name: 'my-release'
        },
        180000,
        '1.2.3'
      )
    })

    it('should handle not ready resource', async () => {
      const mockParseFluxResourceInput = vi.fn().mockReturnValue({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        kind: 'HelmRelease',
        plural: 'helmreleases',
        name: 'my-release'
      })

      const mockWaitForResourceReady = vi.fn().mockResolvedValue({
        ready: false,
        resource: {
          kind: 'HelmRelease',
          metadata: { name: 'my-release' },
          status: {
            conditions: [
              {
                type: 'Ready',
                status: 'False',
                message: 'Reconciliation in progress'
              }
            ]
          }
        }
      })

      const mockIsResourceReady = vi.fn().mockReturnValue(false)

      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          parseFluxResourceInput: mockParseFluxResourceInput,
          waitForResourceReady: mockWaitForResourceReady,
          isResourceReady: mockIsResourceReady
        } as unknown as FluxClient
      })

      const result = await verifySpecificResource(
        mockKubeConfig,
        'test-namespace',
        'helmreleases/my-release',
        undefined,
        '3m'
      )

      expect(result).toEqual([
        {
          name: 'my-release',
          type: 'HelmRelease',
          ready: 'False',
          message: 'Reconciliation in progress'
        }
      ])
    })

    it('should handle resource without conditions', async () => {
      const mockParseFluxResourceInput = vi.fn().mockReturnValue({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        kind: 'HelmRelease',
        plural: 'helmreleases',
        name: 'my-release'
      })

      const mockWaitForResourceReady = vi.fn().mockResolvedValue({
        ready: false,
        resource: {
          kind: 'HelmRelease',
          metadata: { name: 'my-release' },
          status: {}
        }
      })

      const mockIsResourceReady = vi.fn().mockReturnValue(false)

      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          parseFluxResourceInput: mockParseFluxResourceInput,
          waitForResourceReady: mockWaitForResourceReady,
          isResourceReady: mockIsResourceReady
        } as unknown as FluxClient
      })

      const result = await verifySpecificResource(
        mockKubeConfig,
        'test-namespace',
        'helmreleases/my-release',
        undefined,
        '3m'
      )

      expect(result).toEqual([
        {
          name: 'my-release',
          type: 'HelmRelease',
          ready: 'False',
          message: 'Not Ready'
        }
      ])
    })

    it('should handle ready resource without message', async () => {
      const mockParseFluxResourceInput = vi.fn().mockReturnValue({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        kind: 'HelmRelease',
        plural: 'helmreleases',
        name: 'my-release'
      })

      const mockWaitForResourceReady = vi.fn().mockResolvedValue({
        ready: true,
        resource: {
          kind: 'HelmRelease',
          metadata: { name: 'my-release' },
          status: {
            conditions: [
              {
                type: 'Ready',
                status: 'True'
              }
            ]
          }
        }
      })

      const mockIsResourceReady = vi.fn().mockReturnValue(true)

      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          parseFluxResourceInput: mockParseFluxResourceInput,
          waitForResourceReady: mockWaitForResourceReady,
          isResourceReady: mockIsResourceReady
        } as unknown as FluxClient
      })

      const result = await verifySpecificResource(
        mockKubeConfig,
        'test-namespace',
        'helmreleases/my-release',
        undefined,
        '3m'
      )

      expect(result).toEqual([
        {
          name: 'my-release',
          type: 'HelmRelease',
          ready: 'True',
          message: 'Ready'
        }
      ])
    })
  })

  describe('discoverURL', () => {
    it('should discover ingress URL', async () => {
      const mockDiscoverIngressURL = vi
        .fn()
        .mockResolvedValue('https://example.com')

      vi.mocked(KubernetesClient).mockImplementation(function () {
        return {
          discoverIngressURL: mockDiscoverIngressURL
        } as unknown as FluxClient
      })

      const result = await discoverURL(
        mockKubeConfig,
        'test-namespace',
        'app=myapp'
      )

      expect(result).toBe('https://example.com')
      expect(mockDiscoverIngressURL).toHaveBeenCalledWith(
        'test-namespace',
        'app=myapp'
      )
      expect(core.info).not.toHaveBeenCalledWith(
        'Deployment is ready but no URL is available'
      )
    })

    it('should handle missing URL', async () => {
      const mockDiscoverIngressURL = vi.fn().mockResolvedValue('')

      vi.mocked(KubernetesClient).mockImplementation(function () {
        return {
          discoverIngressURL: mockDiscoverIngressURL
        } as unknown as FluxClient
      })

      const result = await discoverURL(
        mockKubeConfig,
        'test-namespace',
        'app=myapp'
      )

      expect(result).toBe('')
      expect(core.info).toHaveBeenCalledWith(
        'Deployment is ready but no URL is available'
      )
    })

    it('should handle null URL', async () => {
      const mockDiscoverIngressURL = vi.fn().mockResolvedValue(null)

      vi.mocked(KubernetesClient).mockImplementation(function () {
        return {
          discoverIngressURL: mockDiscoverIngressURL
        } as unknown as FluxClient
      })

      const result = await discoverURL(
        mockKubeConfig,
        'test-namespace',
        'app=myapp'
      )

      expect(result).toBe('')
      expect(core.info).toHaveBeenCalledWith(
        'Deployment is ready but no URL is available'
      )
    })
  })
})

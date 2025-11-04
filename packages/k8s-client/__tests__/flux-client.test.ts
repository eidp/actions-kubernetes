import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FluxClient } from '../src/flux-client.js'
import * as k8s from '@kubernetes/client-node'
import { FluxResource } from '../src/types.js'

describe('FluxClient.waitForResourceReady', () => {
  let kubeConfig: k8s.KubeConfig
  let fluxClient: FluxClient

  const readyHelmRelease: FluxResource = {
    apiVersion: 'helm.toolkit.fluxcd.io/v2',
    kind: 'HelmRelease',
    metadata: {
      name: 'echo-server-release',
      namespace: 'ci-3-actions-kubernetes'
    },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          reason: 'ReconciliationSucceeded',
          message: 'Release reconciliation succeeded'
        }
      ],
      lastAttemptedRevision: '0.4.0'
    }
  }

  const notReadyHelmRelease: FluxResource = {
    apiVersion: 'helm.toolkit.fluxcd.io/v2',
    kind: 'HelmRelease',
    metadata: {
      name: 'echo-server-release',
      namespace: 'ci-3-actions-kubernetes'
    },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'False',
          reason: 'Progressing',
          message: 'Reconciliation in progress'
        }
      ]
    }
  }

  const readyHelmReleaseUpdated: FluxResource = {
    ...notReadyHelmRelease,
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          reason: 'ReconciliationSucceeded',
          message: 'Release reconciliation succeeded'
        }
      ],
      lastAttemptedRevision: '0.4.0'
    }
  }

  const readyWithWrongVersion: FluxResource = {
    apiVersion: 'helm.toolkit.fluxcd.io/v2',
    kind: 'HelmRelease',
    metadata: {
      name: 'echo-server-release',
      namespace: 'ci-3-actions-kubernetes'
    },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          reason: 'ReconciliationSucceeded',
          message: 'Release reconciliation succeeded'
        }
      ],
      lastAttemptedRevision: '0.3.0'
    }
  }

  const readyWithCorrectVersion: FluxResource = {
    ...readyWithWrongVersion,
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          reason: 'ReconciliationSucceeded',
          message: 'Release reconciliation succeeded'
        }
      ],
      lastAttemptedRevision: '0.4.0'
    }
  }

  beforeEach(() => {
    kubeConfig = new k8s.KubeConfig()
    fluxClient = new FluxClient(kubeConfig)
  })

  it('should return immediately if HelmRelease is already ready', async () => {
    vi.spyOn(fluxClient.k8sClient, 'getCustomResource').mockResolvedValue(
      readyHelmRelease
    )

    const spec = fluxClient.parseFluxResourceInput(
      'helmreleases/echo-server-release'
    )

    const result = await fluxClient.waitForResourceReady(
      'ci-3-actions-kubernetes',
      spec,
      3000, // 3 second timeout
      '0.4.0'
    )

    expect(result.ready).toBe(true)
    expect(result.resource.metadata.name).toBe('echo-server-release')
    expect(result.chartVersion).toBe('0.4.0')
    // Verify that we checked the resource status
    expect(fluxClient.k8sClient.getCustomResource).toHaveBeenCalledWith(
      'helm.toolkit.fluxcd.io',
      'v2',
      'ci-3-actions-kubernetes',
      'helmreleases',
      'echo-server-release'
    )
  })

  it('should return immediately if HelmRelease is ready regardless of chart version when no version specified', async () => {
    vi.spyOn(fluxClient.k8sClient, 'getCustomResource').mockResolvedValue(
      readyHelmRelease
    )

    const spec = fluxClient.parseFluxResourceInput(
      'helmreleases/echo-server-release'
    )

    const result = await fluxClient.waitForResourceReady(
      'ci-3-actions-kubernetes',
      spec,
      3000 // No chart version specified
    )

    expect(result.ready).toBe(true)
    expect(result.resource.metadata.name).toBe('echo-server-release')
  })

  it('should wait for events if HelmRelease is not yet ready', async () => {
    vi.spyOn(fluxClient.k8sClient, 'getCustomResource').mockResolvedValue(
      notReadyHelmRelease
    )

    // Mock the Watch constructor and its watch method
    const mockAbort = vi.fn()
    const mockWatchMethod = vi.fn(
      (
        _path: string,
        _options: Record<string, unknown>,
        callback: (phase: string, apiObj: unknown) => void
      ) => {
        // Simulate the watch receiving a MODIFIED event with ready resource
        setTimeout(() => {
          callback('MODIFIED', readyHelmReleaseUpdated)
        }, 100)

        return Promise.resolve({
          abort: mockAbort,
          signal: {} as AbortSignal
        } as AbortController)
      }
    )

    vi.spyOn(k8s, 'Watch').mockImplementation(
      () =>
        ({
          watch: mockWatchMethod
        }) as unknown as k8s.Watch
    )

    const spec = fluxClient.parseFluxResourceInput(
      'helmreleases/echo-server-release'
    )

    const result = await fluxClient.waitForResourceReady(
      'ci-3-actions-kubernetes',
      spec,
      3000,
      '0.4.0'
    )

    expect(result.ready).toBe(true)
    expect(mockWatchMethod).toHaveBeenCalled()
  })

  it('should wait for correct chart version even if already ready with wrong version', async () => {
    vi.spyOn(fluxClient.k8sClient, 'getCustomResource').mockResolvedValue(
      readyWithWrongVersion
    )

    // Mock the Watch constructor and its watch method
    const mockAbort2 = vi.fn()
    const mockWatchMethod = vi.fn(
      (
        _path: string,
        _options: Record<string, unknown>,
        callback: (phase: string, apiObj: unknown) => void
      ) => {
        setTimeout(() => {
          callback('MODIFIED', readyWithCorrectVersion)
        }, 100)

        return Promise.resolve({
          abort: mockAbort2,
          signal: {} as AbortSignal
        } as AbortController)
      }
    )

    vi.spyOn(k8s, 'Watch').mockImplementation(
      () =>
        ({
          watch: mockWatchMethod
        }) as unknown as k8s.Watch
    )

    const spec = fluxClient.parseFluxResourceInput(
      'helmreleases/echo-server-release'
    )

    const result = await fluxClient.waitForResourceReady(
      'ci-3-actions-kubernetes',
      spec,
      3000,
      '0.4.0'
    )

    expect(result.ready).toBe(true)
    expect(result.chartVersion).toBe('0.4.0')
  })
})

describe('FluxClient - CRUD operations', () => {
  let kubeConfig: k8s.KubeConfig
  let fluxClient: FluxClient

  beforeEach(() => {
    kubeConfig = new k8s.KubeConfig()
    fluxClient = new FluxClient(kubeConfig)
    vi.spyOn(fluxClient.k8sClient, 'applyCustomObject').mockResolvedValue()
    vi.spyOn(fluxClient.k8sClient, 'listCustomResources').mockResolvedValue([])
    vi.spyOn(fluxClient.k8sClient, 'deleteCustomResource').mockResolvedValue()
  })

  describe('createOCIRepository', () => {
    it('should create an OCIRepository', async () => {
      const ociRepo: import('../src/types.js').OCIRepository = {
        apiVersion: 'source.toolkit.fluxcd.io/v1',
        kind: 'OCIRepository',
        metadata: { name: 'test-oci', namespace: 'flux-system' },
        spec: {
          url: 'oci://example.com/repo',
          interval: '5m',
          ref: { tag: 'latest' }
        }
      }

      await fluxClient.createOCIRepository(ociRepo)

      expect(fluxClient.k8sClient.applyCustomObject).toHaveBeenCalledWith(
        ociRepo,
        'flux-client'
      )
    })

    it('should create an OCIRepository with custom field manager', async () => {
      const ociRepo: import('../src/types.js').OCIRepository = {
        apiVersion: 'source.toolkit.fluxcd.io/v1',
        kind: 'OCIRepository',
        metadata: { name: 'test-oci', namespace: 'flux-system' },
        spec: {
          url: 'oci://example.com/repo',
          interval: '5m',
          ref: { tag: 'latest' }
        }
      }

      await fluxClient.createOCIRepository(ociRepo, 'custom-manager')

      expect(fluxClient.k8sClient.applyCustomObject).toHaveBeenCalledWith(
        ociRepo,
        'custom-manager'
      )
    })
  })

  describe('createKustomization', () => {
    it('should create a Kustomization', async () => {
      const kust: import('../src/types.js').Kustomization = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'test-kust', namespace: 'flux-system' },
        spec: {
          serviceAccountName: 'default',
          interval: '10m',
          sourceRef: { kind: 'OCIRepository', name: 'test-oci' },
          path: './',
          prune: true,
          wait: true,
          timeout: '5m'
        }
      }

      await fluxClient.createKustomization(kust)

      expect(fluxClient.k8sClient.applyCustomObject).toHaveBeenCalledWith(
        kust,
        'flux-client'
      )
    })
  })

  describe('listKustomizations', () => {
    it('should list kustomizations with label selector', async () => {
      const mockKusts = [
        {
          apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
          kind: 'Kustomization',
          metadata: { name: 'kust-1', namespace: 'infra-fluxcd' }
        }
      ]

      vi.spyOn(fluxClient.k8sClient, 'listCustomResources').mockResolvedValue(
        mockKusts
      )

      const result = await fluxClient.listKustomizations('app=test')

      expect(result).toEqual(mockKusts)
      expect(fluxClient.k8sClient.listCustomResources).toHaveBeenCalledWith(
        'kustomize.toolkit.fluxcd.io',
        'v1',
        'infra-fluxcd',
        'kustomizations',
        'app=test'
      )
    })
  })

  describe('listOCIRepositories', () => {
    it('should list OCIRepositories with label selector', async () => {
      const mockOCIs = [
        {
          apiVersion: 'source.toolkit.fluxcd.io/v1',
          kind: 'OCIRepository',
          metadata: { name: 'oci-1', namespace: 'infra-fluxcd' }
        }
      ]

      vi.spyOn(fluxClient.k8sClient, 'listCustomResources').mockResolvedValue(
        mockOCIs
      )

      const result = await fluxClient.listOCIRepositories('app=test')

      expect(result).toEqual(mockOCIs)
      expect(fluxClient.k8sClient.listCustomResources).toHaveBeenCalledWith(
        'source.toolkit.fluxcd.io',
        'v1',
        'infra-fluxcd',
        'ocirepositories',
        'app=test'
      )
    })
  })

  describe('findResourcesByLabel', () => {
    it('should find both kustomizations and OCIRepositories', async () => {
      const mockKusts = [
        {
          apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
          kind: 'Kustomization',
          metadata: { name: 'kust-1', namespace: 'infra-fluxcd' }
        }
      ]
      const mockOCIs = [
        {
          apiVersion: 'source.toolkit.fluxcd.io/v1',
          kind: 'OCIRepository',
          metadata: { name: 'oci-1', namespace: 'infra-fluxcd' }
        }
      ]

      vi.spyOn(fluxClient.k8sClient, 'listCustomResources')
        .mockResolvedValueOnce(mockKusts)
        .mockResolvedValueOnce(mockOCIs)

      const result = await fluxClient.findResourcesByLabel('app=test')

      expect(result.kustomizations).toEqual(mockKusts)
      expect(result.ociRepositories).toEqual(mockOCIs)
    })
  })

  describe('deleteKustomization', () => {
    it('should delete a kustomization', async () => {
      await fluxClient.deleteKustomization('test-kust')

      expect(fluxClient.k8sClient.deleteCustomResource).toHaveBeenCalledWith(
        'kustomize.toolkit.fluxcd.io',
        'v1',
        'infra-fluxcd',
        'kustomizations',
        'test-kust'
      )
    })

    it('should skip deletion when dry run is true', async () => {
      await fluxClient.deleteKustomization('test-kust', true)

      expect(fluxClient.k8sClient.deleteCustomResource).not.toHaveBeenCalled()
    })

    it('should handle 404 errors gracefully', async () => {
      const notFoundError = new Error('Not found')
      Object.assign(notFoundError, { code: 404 })

      vi.spyOn(fluxClient.k8sClient, 'deleteCustomResource').mockRejectedValue(
        notFoundError
      )
      vi.spyOn(fluxClient.k8sClient, 'isNotFoundError').mockReturnValue(true)

      await fluxClient.deleteKustomization('test-kust')

      expect(fluxClient.k8sClient.deleteCustomResource).toHaveBeenCalled()
    })

    it('should rethrow non-404 errors', async () => {
      const error = new Error('Server error')

      vi.spyOn(fluxClient.k8sClient, 'deleteCustomResource').mockRejectedValue(
        error
      )
      vi.spyOn(fluxClient.k8sClient, 'isNotFoundError').mockReturnValue(false)

      await expect(fluxClient.deleteKustomization('test-kust')).rejects.toThrow(
        'Server error'
      )
    })
  })

  describe('deleteOCIRepository', () => {
    it('should delete an OCIRepository', async () => {
      await fluxClient.deleteOCIRepository('test-oci')

      expect(fluxClient.k8sClient.deleteCustomResource).toHaveBeenCalledWith(
        'source.toolkit.fluxcd.io',
        'v1',
        'infra-fluxcd',
        'ocirepositories',
        'test-oci'
      )
    })

    it('should skip deletion when dry run is true', async () => {
      await fluxClient.deleteOCIRepository('test-oci', true)

      expect(fluxClient.k8sClient.deleteCustomResource).not.toHaveBeenCalled()
    })

    it('should handle 404 errors gracefully', async () => {
      const notFoundError = new Error('Not found')
      Object.assign(notFoundError, { code: 404 })

      vi.spyOn(fluxClient.k8sClient, 'deleteCustomResource').mockRejectedValue(
        notFoundError
      )
      vi.spyOn(fluxClient.k8sClient, 'isNotFoundError').mockReturnValue(true)

      await fluxClient.deleteOCIRepository('test-oci')

      expect(fluxClient.k8sClient.deleteCustomResource).toHaveBeenCalled()
    })

    it('should handle other errors gracefully', async () => {
      const error = new Error('Server error')

      vi.spyOn(fluxClient.k8sClient, 'deleteCustomResource').mockRejectedValue(
        error
      )
      vi.spyOn(fluxClient.k8sClient, 'isNotFoundError').mockReturnValue(false)

      await fluxClient.deleteOCIRepository('test-oci')

      expect(fluxClient.k8sClient.deleteCustomResource).toHaveBeenCalled()
    })
  })

  describe('parseFluxResourceInput', () => {
    it('should parse HelmRelease input', () => {
      const result = fluxClient.parseFluxResourceInput(
        'helmreleases/my-release'
      )

      expect(result).toEqual({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        kind: 'HelmRelease',
        plural: 'helmreleases',
        name: 'my-release'
      })
    })

    it('should parse Kustomization input', () => {
      const result = fluxClient.parseFluxResourceInput('kustomizations/my-kust')

      expect(result).toEqual({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        kind: 'Kustomization',
        plural: 'kustomizations',
        name: 'my-kust'
      })
    })

    it('should throw error for invalid input format', () => {
      expect(() => fluxClient.parseFluxResourceInput('invalid')).toThrow(
        'Invalid flux-resource format'
      )
    })

    it('should throw error for unsupported resource type', () => {
      expect(() =>
        fluxClient.parseFluxResourceInput('unsupported/resource')
      ).toThrow('Unsupported flux resource type')
    })
  })
})

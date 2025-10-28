import * as k8s from '@kubernetes/client-node'
import * as core from '@actions/core'
import { listAndWatchAllResources } from '../src/flux-resources'
import { HelmRelease, Kustomization } from '../src/types'

jest.mock('@actions/core')

interface MockCustomObjectsApi {
  listNamespacedCustomObject: jest.Mock
}

interface MockWatch {
  watch: jest.Mock
}

describe('listAndWatchAllResources', () => {
  let mockKubeConfig: k8s.KubeConfig
  let mockCustomApi: MockCustomObjectsApi
  let mockWatch: MockWatch

  beforeEach(() => {
    jest.clearAllMocks()

    mockCustomApi = {
      listNamespacedCustomObject: jest.fn()
    }

    mockWatch = {
      watch: jest.fn()
    }

    mockKubeConfig = {
      makeApiClient: jest.fn().mockReturnValue(mockCustomApi)
    } as unknown as k8s.KubeConfig
    ;(k8s.Watch as jest.MockedClass<typeof k8s.Watch>) = jest
      .fn()
      .mockImplementation(
        () => mockWatch as unknown as k8s.Watch
      ) as unknown as jest.MockedClass<typeof k8s.Watch>
  })

  describe('no resources found', () => {
    it('should return empty array and warn when no resources exist', async () => {
      mockCustomApi.listNamespacedCustomObject.mockResolvedValue({
        items: []
      })

      const result = await listAndWatchAllResources(
        mockKubeConfig,
        'default',
        60000
      )

      expect(result).toEqual([])
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'No HelmReleases or Kustomizations found in namespace'
        )
      )
    })
  })

  describe('all resources already ready', () => {
    it('should return immediately when all resources are ready', async () => {
      const readyHelmRelease: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }

      const readyKustomization: Kustomization = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'ks-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [readyHelmRelease] })
        .mockResolvedValueOnce({ items: [readyKustomization] })

      const result = await listAndWatchAllResources(
        mockKubeConfig,
        'default',
        60000
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        type: 'HelmRelease',
        name: 'helm-1',
        ready: 'True',
        message: 'Ready'
      })
      expect(result[1]).toEqual({
        type: 'Kustomization',
        name: 'ks-1',
        ready: 'True',
        message: 'Ready'
      })
      expect(core.info).toHaveBeenCalledWith(
        '✅ All resources are already ready'
      )
      expect(mockWatch.watch).not.toHaveBeenCalled()
    })
  })

  describe('watching resources to become ready', () => {
    let helmEventCallback: (type: string, apiObj: unknown) => void
    let helmDoneCallback: (err?: Error) => void
    let ksEventCallback: (type: string, apiObj: unknown) => void
    let ksDoneCallback: (err?: Error) => void
    let mockWatchRequest: { abort: jest.Mock }

    beforeEach(() => {
      mockWatchRequest = { abort: jest.fn() }

      mockWatch.watch.mockImplementation((path, _options, onEvent, onDone) => {
        if (path.includes('helmreleases')) {
          helmEventCallback = onEvent
          helmDoneCallback = onDone
        } else if (path.includes('kustomizations')) {
          ksEventCallback = onEvent
          ksDoneCallback = onDone
        }
        return Promise.resolve(mockWatchRequest)
      })
    })

    it('should watch and resolve when all resources become ready', async () => {
      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      const notReadyKs: Kustomization = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'ks-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      // Initial list calls
      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [notReadyKs] })
        // Final fetch calls after ready
        .mockResolvedValueOnce({
          items: [
            {
              ...notReadyHelm,
              status: {
                conditions: [
                  { type: 'Ready', status: 'True', message: 'Ready' }
                ]
              }
            }
          ]
        })
        .mockResolvedValueOnce({
          items: [
            {
              ...notReadyKs,
              status: {
                conditions: [
                  { type: 'Ready', status: 'True', message: 'Ready' }
                ]
              }
            }
          ]
        })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      // Wait for watch setup
      await new Promise((resolve) => setImmediate(resolve))

      expect(core.info).toHaveBeenCalledWith(
        "Found 1 HelmRelease(s) and 1 Kustomization(s) in namespace 'default'"
      )
      expect(core.info).toHaveBeenCalledWith(
        '2 resource(s) not ready yet, watching for changes...'
      )

      // Simulate HelmRelease becoming ready
      helmEventCallback('MODIFIED', {
        ...notReadyHelm,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      })

      // Not resolved yet - still waiting for Kustomization
      await new Promise((resolve) => setImmediate(resolve))

      // Simulate Kustomization becoming ready
      ksEventCallback('MODIFIED', {
        ...notReadyKs,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      })

      const result = await promise

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('helm-1')
      expect(result[0].ready).toBe('True')
      expect(result[1].name).toBe('ks-1')
      expect(result[1].ready).toBe('True')
      expect(core.info).toHaveBeenCalledWith('✅ All resources are ready')
    })

    it('should watch only HelmReleases when no Kustomizations exist', async () => {
      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [] }) // No Kustomizations
        .mockResolvedValueOnce({
          items: [
            {
              ...notReadyHelm,
              status: {
                conditions: [
                  { type: 'Ready', status: 'True', message: 'Ready' }
                ]
              }
            }
          ]
        })
        .mockResolvedValueOnce({ items: [] })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      await new Promise((resolve) => setImmediate(resolve))

      // Should only watch HelmReleases
      expect(mockWatch.watch).toHaveBeenCalledTimes(1)
      expect(mockWatch.watch).toHaveBeenCalledWith(
        '/apis/helm.toolkit.fluxcd.io/v2/namespaces/default/helmreleases',
        expect.any(Object),
        expect.any(Function),
        expect.any(Function)
      )

      helmEventCallback('MODIFIED', {
        ...notReadyHelm,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      })

      const result = await promise
      expect(result).toHaveLength(1)
    })

    it('should watch only Kustomizations when no HelmReleases exist', async () => {
      const notReadyKs: Kustomization = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'ks-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [] }) // No HelmReleases
        .mockResolvedValueOnce({ items: [notReadyKs] })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [
            {
              ...notReadyKs,
              status: {
                conditions: [
                  { type: 'Ready', status: 'True', message: 'Ready' }
                ]
              }
            }
          ]
        })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      await new Promise((resolve) => setImmediate(resolve))

      // Should only watch Kustomizations
      expect(mockWatch.watch).toHaveBeenCalledTimes(1)
      expect(mockWatch.watch).toHaveBeenCalledWith(
        '/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/default/kustomizations',
        expect.any(Object),
        expect.any(Function),
        expect.any(Function)
      )

      ksEventCallback('MODIFIED', {
        ...notReadyKs,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      })

      const result = await promise
      expect(result).toHaveLength(1)
    })

    it('should handle mixed ready/not-ready resources', async () => {
      const readyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-ready', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }

      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-not-ready', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [readyHelm, notReadyHelm] })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [
            readyHelm,
            {
              ...notReadyHelm,
              status: {
                conditions: [
                  { type: 'Ready', status: 'True', message: 'Ready' }
                ]
              }
            }
          ]
        })
        .mockResolvedValueOnce({ items: [] })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      await new Promise((resolve) => setImmediate(resolve))

      expect(core.info).toHaveBeenCalledWith(
        '1 resource(s) not ready yet, watching for changes...'
      )

      helmEventCallback('MODIFIED', {
        ...notReadyHelm,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      })

      const result = await promise
      expect(result).toHaveLength(2)
    })

    it('should reject on timeout with not-ready status', async () => {
      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [] })
        // Timeout fetch
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [] })

      const promise = listAndWatchAllResources(
        mockKubeConfig,
        'default',
        100 // 100ms timeout
      )

      await expect(promise).rejects.toThrow(
        "Not all flux resources are ready in namespace 'default' within timeout"
      )

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Not all flux resources are ready')
      )
      expect(core.startGroup).toHaveBeenCalledWith('Resources not ready')
      expect(core.error).toHaveBeenCalledWith('  HelmRelease/helm-1: Pending')
      expect(mockWatchRequest.abort).toHaveBeenCalled()
    })

    it('should reject on HelmRelease watch error', async () => {
      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [] })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      await new Promise((resolve) => setImmediate(resolve))

      helmDoneCallback(new Error('Connection lost'))

      await expect(promise).rejects.toThrow(
        'Watch error for HelmReleases: Error: Connection lost'
      )
    })

    it('should reject on Kustomization watch error', async () => {
      const notReadyKs: Kustomization = {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'ks-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [notReadyKs] })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      await new Promise((resolve) => setImmediate(resolve))

      ksDoneCallback(new Error('Connection lost'))

      await expect(promise).rejects.toThrow(
        'Watch error for Kustomizations: Error: Connection lost'
      )
    })

    it('should reject if HelmRelease watch fails to start', async () => {
      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [] })

      mockWatch.watch.mockRejectedValue(new Error('Failed to start'))

      await expect(
        listAndWatchAllResources(mockKubeConfig, 'default', 60000)
      ).rejects.toThrow('Failed to start watch for HelmReleases')
    })

    it('should ignore events for resources that are still not ready', async () => {
      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [
            {
              ...notReadyHelm,
              status: {
                conditions: [
                  { type: 'Ready', status: 'True', message: 'Ready' }
                ]
              }
            }
          ]
        })
        .mockResolvedValueOnce({ items: [] })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      await new Promise((resolve) => setImmediate(resolve))

      // Send event with still not ready status
      helmEventCallback('MODIFIED', notReadyHelm)

      // Should not resolve yet
      await new Promise((resolve) => setImmediate(resolve))

      // Now make it ready
      helmEventCallback('MODIFIED', {
        ...notReadyHelm,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      })

      const result = await promise
      expect(result).toHaveLength(1)
    })

    it('should ignore AbortError when watches are intentionally aborted', async () => {
      const notReadyHelm: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'helm-1', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'False', message: 'Pending' }]
        }
      }

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [notReadyHelm] })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [
            {
              ...notReadyHelm,
              status: {
                conditions: [
                  { type: 'Ready', status: 'True', message: 'Ready' }
                ]
              }
            }
          ]
        })
        .mockResolvedValueOnce({ items: [] })

      const promise = listAndWatchAllResources(mockKubeConfig, 'default', 60000)

      await new Promise((resolve) => setImmediate(resolve))

      // Make the resource ready to trigger completion
      helmEventCallback('MODIFIED', {
        ...notReadyHelm,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      })

      // Simulate AbortError from cleanup
      const abortError = new Error('The user aborted a request.')
      abortError.name = 'AbortError'
      helmDoneCallback(abortError)

      // Should still resolve successfully, not reject with AbortError
      const result = await promise
      expect(result).toHaveLength(1)
      expect(result[0].ready).toBe('True')
    })
  })
})

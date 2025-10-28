import * as k8s from '@kubernetes/client-node'
import * as core from '@actions/core'
import { waitForResourceReady } from '../src/flux-resources'
import { FluxResourceSpec } from '../src/flux-resource-spec'
import { HelmRelease } from '../src/types'

jest.mock('@actions/core')

interface MockCustomObjectsApi {
  getNamespacedCustomObject: jest.Mock
}

interface MockWatch {
  watch: jest.Mock
}

describe('waitForResourceReady', () => {
  let mockKubeConfig: k8s.KubeConfig
  let mockCustomApi: MockCustomObjectsApi
  let mockWatch: MockWatch
  let spec: FluxResourceSpec

  beforeEach(() => {
    jest.clearAllMocks()

    spec = {
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      plural: 'helmreleases',
      name: 'test-release',
      kind: 'HelmRelease'
    }

    mockCustomApi = {
      getNamespacedCustomObject: jest.fn()
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

  describe('resource already ready', () => {
    it('should return immediately when resource is already ready', async () => {
      const readyResource: HelmRelease = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test-release', namespace: 'default' },
        status: {
          conditions: [
            {
              type: 'Ready',
              status: 'True',
              message: 'Release reconciliation succeeded'
            }
          ]
        }
      }

      mockCustomApi.getNamespacedCustomObject.mockResolvedValue(readyResource)

      const result = await waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      expect(result).toEqual({
        type: 'HelmRelease',
        name: 'test-release',
        ready: 'True',
        message: 'Release reconciliation succeeded'
      })
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("'test-release' is already ready")
      )
      expect(mockWatch.watch).not.toHaveBeenCalled()
    })
  })

  describe('resource does not exist', () => {
    it('should throw error when resource returns 404', async () => {
      const error = Object.assign(new Error('Not found'), { statusCode: 404 })
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(error)

      await expect(
        waitForResourceReady(mockKubeConfig, 'default', spec, 60000)
      ).rejects.toThrow(
        "HelmRelease 'test-release' does not exist in namespace 'default'"
      )
    })

    it('should throw generic error for other API errors', async () => {
      const error = Object.assign(new Error('API error'), { statusCode: 500 })
      mockCustomApi.getNamespacedCustomObject.mockRejectedValue(error)

      await expect(
        waitForResourceReady(mockKubeConfig, 'default', spec, 60000)
      ).rejects.toThrow("Failed to get HelmRelease 'test-release': API error")
    })
  })

  describe('watching for resource to become ready', () => {
    let notReadyResource: HelmRelease
    let eventCallback: (type: string, apiObj: unknown) => void
    let doneCallback: (err?: Error) => void
    let mockWatchRequest: { abort: jest.Mock }

    beforeEach(() => {
      notReadyResource = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: { name: 'test-release', namespace: 'default' },
        status: {
          conditions: [
            {
              type: 'Ready',
              status: 'False',
              message: 'Reconciling'
            }
          ]
        }
      }

      mockWatchRequest = { abort: jest.fn() }

      mockCustomApi.getNamespacedCustomObject.mockResolvedValue(
        notReadyResource
      )

      mockWatch.watch.mockImplementation((path, _options, onEvent, onDone) => {
        eventCallback = onEvent
        doneCallback = onDone
        return Promise.resolve(mockWatchRequest)
      })
    })

    it('should wait and resolve when resource becomes ready', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      // Wait for initial check and watch setup
      await new Promise((resolve) => setImmediate(resolve))

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('not ready yet, waiting for Ready condition')
      )

      // Simulate resource becoming ready
      const readyResource: HelmRelease = {
        ...notReadyResource,
        status: {
          conditions: [
            {
              type: 'Ready',
              status: 'True',
              message: 'Release reconciliation succeeded'
            }
          ]
        }
      }

      eventCallback('MODIFIED', readyResource)

      const result = await promise

      expect(result).toEqual({
        type: 'HelmRelease',
        name: 'test-release',
        ready: 'True',
        message: 'Release reconciliation succeeded'
      })
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "'test-release' in namespace 'default' is ready"
        )
      )
    })

    it('should handle ADDED event type', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      await new Promise((resolve) => setImmediate(resolve))

      const readyResource: HelmRelease = {
        ...notReadyResource,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }

      eventCallback('ADDED', readyResource)

      const result = await promise
      expect(result.ready).toBe('True')
    })

    it('should ignore events for different resources', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      await new Promise((resolve) => setImmediate(resolve))

      // Send event for different resource
      const otherResource: HelmRelease = {
        ...notReadyResource,
        metadata: { name: 'other-release', namespace: 'default' },
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }

      eventCallback('MODIFIED', otherResource)

      // Should not resolve yet
      await new Promise((resolve) => setImmediate(resolve))

      // Now send the correct resource
      const readyResource: HelmRelease = {
        ...notReadyResource,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }

      eventCallback('MODIFIED', readyResource)

      const result = await promise
      expect(result.name).toBe('test-release')
    })

    it('should continue waiting if resource is still not ready', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      await new Promise((resolve) => setImmediate(resolve))

      // Send modified event but still not ready
      eventCallback('MODIFIED', notReadyResource)

      // Should not resolve yet
      await new Promise((resolve) => setImmediate(resolve))

      // Now make it ready
      const readyResource: HelmRelease = {
        ...notReadyResource,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }

      eventCallback('MODIFIED', readyResource)

      const result = await promise
      expect(result.ready).toBe('True')
    })

    it('should reject on timeout', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        100 // 100ms timeout
      )

      await expect(promise).rejects.toThrow(
        "HelmRelease 'test-release' is not ready in namespace 'default' within timeout"
      )

      expect(mockWatchRequest.abort).toHaveBeenCalled()
    })

    it('should reject on watch error', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      await new Promise((resolve) => setImmediate(resolve))

      doneCallback(new Error('Watch connection lost'))

      await expect(promise).rejects.toThrow(
        "Watch error for HelmRelease 'test-release': Watch connection lost"
      )
    })

    it('should reject if watch.watch() fails', async () => {
      mockWatch.watch.mockRejectedValue(new Error('Failed to start watch'))

      await expect(
        waitForResourceReady(mockKubeConfig, 'default', spec, 60000)
      ).rejects.toThrow(
        "Failed to start watch for HelmRelease 'test-release': Failed to start watch"
      )
    })

    it('should use correct watch path and options', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      await new Promise((resolve) => setImmediate(resolve))

      expect(mockWatch.watch).toHaveBeenCalledWith(
        '/apis/helm.toolkit.fluxcd.io/v2/namespaces/default/helmreleases',
        {
          allowWatchBookmarks: true,
          fieldSelector: 'metadata.name=test-release'
        },
        expect.any(Function),
        expect.any(Function)
      )

      // Cleanup
      const readyResource: HelmRelease = {
        ...notReadyResource,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }
      eventCallback('MODIFIED', readyResource)
      await promise
    })
  })
})

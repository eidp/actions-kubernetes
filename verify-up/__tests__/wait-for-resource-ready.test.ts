import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as k8s from '@kubernetes/client-node'
import * as core from '@actions/core'
import { waitForResourceReady } from '../src/flux-resources'
import { FluxResourceSpec, HelmRelease } from '../src/types'

interface MockWatch {
  watch: ReturnType<typeof vi.fn>
}

describe('waitForResourceReady', () => {
  let mockKubeConfig: k8s.KubeConfig
  let mockWatch: MockWatch
  let spec: FluxResourceSpec

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock core.info
    vi.spyOn(core, 'info').mockImplementation(() => {})

    spec = {
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      plural: 'helmreleases',
      name: 'test-release',
      kind: 'HelmRelease'
    }

    mockWatch = {
      watch: vi.fn()
    }

    mockKubeConfig = {} as unknown as k8s.KubeConfig
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(k8s.Watch as any) = vi
      .fn()
      .mockImplementation(() => mockWatch as unknown as k8s.Watch)
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

      mockWatchRequest = { abort: vi.fn() }

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

      // Wait for watch setup
      await new Promise((resolve) => setImmediate(resolve))

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "Waiting for HelmRelease 'test-release' to be ready"
        )
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

    it('should retry on watch error and eventually timeout', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        100 // Short timeout
      )

      await new Promise((resolve) => setImmediate(resolve))

      doneCallback(new Error('Watch connection lost'))

      // With short timeout, overall timeout fires before retries complete
      await expect(promise).rejects.toThrow(
        "is not ready in namespace 'default' within timeout"
      )
    }, 10000)

    it('should reject if watch.watch() fails after retries', async () => {
      mockWatch.watch.mockRejectedValue(new Error('Failed to start watch'))

      await expect(
        waitForResourceReady(mockKubeConfig, 'default', spec, 100) // Short timeout
      ).rejects.toThrow(
        "Failed to start watch for HelmRelease 'test-release': Failed to start watch"
      )
    }, 10000)

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

    it('should ignore AbortError when watch is intentionally aborted', async () => {
      const promise = waitForResourceReady(
        mockKubeConfig,
        'default',
        spec,
        60000
      )

      await new Promise((resolve) => setImmediate(resolve))

      // Simulate successful completion that triggers abort
      const readyResource: HelmRelease = {
        ...notReadyResource,
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'Ready' }]
        }
      }
      eventCallback('MODIFIED', readyResource)

      // Then simulate AbortError from cleanup
      const abortError = new Error('The user aborted a request.')
      abortError.name = 'AbortError'
      doneCallback(abortError)

      // Should still resolve successfully, not reject with AbortError
      await expect(promise).resolves.toMatchObject({
        name: 'test-release',
        ready: 'True'
      })
    })
  })
})

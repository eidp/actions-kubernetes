import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FluxClient } from '../src/flux-client'
import * as k8s from '@kubernetes/client-node'
import { FluxResource } from '../src/types'

describe('FluxClient.waitForResourceReady', () => {
  let kubeConfig: k8s.KubeConfig
  let fluxClient: FluxClient

  beforeEach(() => {
    kubeConfig = new k8s.KubeConfig()
    fluxClient = new FluxClient(kubeConfig)
  })

  it('should return immediately if HelmRelease is already ready', async () => {
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
        lastAppliedRevision: '0.4.0'
      }
    }

    // Mock the k8sClient.getCustomResource to return already-ready resource
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
        lastAppliedRevision: '0.4.0'
      }
    }

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

    const readyHelmRelease: FluxResource = {
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
        lastAppliedRevision: '0.4.0'
      }
    }

    // Initial fetch returns not ready
    vi.spyOn(fluxClient.k8sClient, 'getCustomResource').mockResolvedValue(
      notReadyHelmRelease
    )

    // Mock the Watch constructor and its watch method
    const mockWatchMethod = vi.fn((path, options, callback) => {
      // Simulate the watch receiving a MODIFIED event with ready resource
      setTimeout(() => {
        callback('MODIFIED', readyHelmRelease)
      }, 100)

      return Promise.resolve({ abort: vi.fn() })
    })

    vi.spyOn(k8s, 'Watch').mockImplementation(() => ({
      watch: mockWatchMethod
    }))

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
        lastAppliedRevision: '0.3.0' // Wrong version
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
        lastAppliedRevision: '0.4.0' // Correct version
      }
    }

    // Initial fetch returns wrong version
    vi.spyOn(fluxClient.k8sClient, 'getCustomResource').mockResolvedValue(
      readyWithWrongVersion
    )

    // Mock the Watch constructor and its watch method
    const mockWatchMethod = vi.fn((path, options, callback) => {
      setTimeout(() => {
        callback('MODIFIED', readyWithCorrectVersion)
      }, 100)

      return Promise.resolve({ abort: vi.fn() })
    })

    vi.spyOn(k8s, 'Watch').mockImplementation(() => ({
      watch: mockWatchMethod
    }))

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

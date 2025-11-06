import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { KubernetesClient } from '../src/kubernetes-client.js'

interface MockCoreApi {
  readNamespacedConfigMap: ReturnType<typeof vi.fn>
}

interface MockCustomApi {
  listNamespacedCustomObject: ReturnType<typeof vi.fn>
  getNamespacedCustomObject: ReturnType<typeof vi.fn>
  deleteNamespacedCustomObject: ReturnType<typeof vi.fn>
}

interface MockNetworkingApi {
  listNamespacedIngress: ReturnType<typeof vi.fn>
}

describe('KubernetesClient', () => {
  let mockKubeConfig: k8s.KubeConfig
  let client: KubernetesClient
  let mockCoreApi: MockCoreApi
  let mockCustomApi: MockCustomApi
  let mockNetworkingApi: MockNetworkingApi

  const mockConfigMap = {
    metadata: { name: 'test-config', namespace: 'default' },
    data: { key: 'value' }
  }

  const mockCustomResource = {
    apiVersion: 'v1',
    kind: 'Test',
    metadata: { name: 'test-resource' },
    spec: {}
  }

  const mockCustomResources = {
    items: [
      {
        apiVersion: 'v1',
        kind: 'Test',
        metadata: { name: 'resource-1' },
        spec: {}
      },
      {
        apiVersion: 'v1',
        kind: 'Test',
        metadata: { name: 'resource-2' },
        spec: {}
      }
    ]
  }

  const mockIngressWithTLS = {
    items: [
      {
        metadata: { name: 'test-ingress' },
        spec: {
          rules: [{ host: 'example.com' }],
          tls: [{ hosts: ['example.com'] }]
        }
      }
    ]
  }

  const mockIngressWithoutTLS = {
    items: [
      {
        metadata: { name: 'test-ingress' },
        spec: {
          rules: [{ host: 'example.com' }]
        }
      }
    ]
  }

  const mockMultipleIngresses = {
    items: [
      {
        metadata: { name: 'ingress-1' },
        spec: { rules: [{ host: 'example1.com' }] }
      },
      {
        metadata: { name: 'ingress-2' },
        spec: { rules: [{ host: 'example2.com' }] }
      }
    ]
  }

  const mockIngressNoHost = {
    items: [
      {
        metadata: { name: 'test-ingress' },
        spec: { rules: [{}] }
      }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'warning').mockImplementation(() => {})

    mockCoreApi = {
      readNamespacedConfigMap: vi.fn()
    }

    mockCustomApi = {
      listNamespacedCustomObject: vi.fn(),
      getNamespacedCustomObject: vi.fn(),
      deleteNamespacedCustomObject: vi.fn()
    }

    mockNetworkingApi = {
      listNamespacedIngress: vi.fn()
    }

    mockKubeConfig = {
      makeApiClient: vi.fn((apiType: unknown) => {
        if (apiType === k8s.CoreV1Api) return mockCoreApi
        if (apiType === k8s.CustomObjectsApi) return mockCustomApi
        if (apiType === k8s.NetworkingV1Api) return mockNetworkingApi
        return null
      })
    } as unknown as k8s.KubeConfig
  })

  describe('readConfigMap', () => {
    it('should read a ConfigMap successfully', async () => {
      mockCoreApi.readNamespacedConfigMap.mockResolvedValue(mockConfigMap)

      client = new KubernetesClient(mockKubeConfig)
      const result = await client.readConfigMap('test-config', 'default')

      expect(result).toEqual(mockConfigMap)
      expect(mockCoreApi.readNamespacedConfigMap).toHaveBeenCalledWith({
        name: 'test-config',
        namespace: 'default'
      })
    })

    it('should throw error when ConfigMap read fails', async () => {
      mockCoreApi.readNamespacedConfigMap.mockRejectedValue(
        new Error('API error')
      )

      client = new KubernetesClient(mockKubeConfig)

      await expect(
        client.readConfigMap('test-config', 'default')
      ).rejects.toThrow(
        "Failed to read ConfigMap 'test-config' from namespace 'default': API error"
      )
    })

    it('should re-throw non-Error thrown values', async () => {
      mockCoreApi.readNamespacedConfigMap.mockRejectedValue('String error')

      client = new KubernetesClient(mockKubeConfig)

      await expect(client.readConfigMap('test-config', 'default')).rejects.toBe(
        'String error'
      )
    })
  })

  describe('listCustomResources', () => {
    it('should list custom resources with label selector', async () => {
      mockCustomApi.listNamespacedCustomObject.mockResolvedValue(
        mockCustomResources
      )

      client = new KubernetesClient(mockKubeConfig)
      const result = await client.listCustomResources(
        'test.io',
        'v1',
        'default',
        'tests',
        'app=test'
      )

      expect(result).toEqual(mockCustomResources.items)
      expect(mockCustomApi.listNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'test.io',
        version: 'v1',
        namespace: 'default',
        plural: 'tests',
        labelSelector: 'app=test'
      })
    })
  })

  describe('getCustomResource', () => {
    it('should get a custom resource', async () => {
      mockCustomApi.getNamespacedCustomObject.mockResolvedValue(
        mockCustomResource
      )

      client = new KubernetesClient(mockKubeConfig)
      const result = await client.getCustomResource(
        'test.io',
        'v1',
        'default',
        'tests',
        'test-resource'
      )

      expect(result).toEqual(mockCustomResource)
      expect(mockCustomApi.getNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'test.io',
        version: 'v1',
        namespace: 'default',
        plural: 'tests',
        name: 'test-resource'
      })
    })
  })

  describe('deleteCustomResource', () => {
    it('should delete a custom resource with default propagation policy', async () => {
      mockCustomApi.deleteNamespacedCustomObject.mockResolvedValue({})

      client = new KubernetesClient(mockKubeConfig)
      await client.deleteCustomResource(
        'test.io',
        'v1',
        'default',
        'tests',
        'test-resource'
      )

      expect(mockCustomApi.deleteNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'test.io',
        version: 'v1',
        namespace: 'default',
        plural: 'tests',
        name: 'test-resource',
        propagationPolicy: 'Background'
      })
    })

    it('should delete a custom resource with custom propagation policy', async () => {
      mockCustomApi.deleteNamespacedCustomObject.mockResolvedValue({})

      client = new KubernetesClient(mockKubeConfig)
      await client.deleteCustomResource(
        'test.io',
        'v1',
        'default',
        'tests',
        'test-resource',
        'Foreground'
      )

      expect(mockCustomApi.deleteNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'test.io',
        version: 'v1',
        namespace: 'default',
        plural: 'tests',
        name: 'test-resource',
        propagationPolicy: 'Foreground'
      })
    })
  })

  describe('isNotFoundError', () => {
    it('should return true for 404 errors', () => {
      client = new KubernetesClient(mockKubeConfig)
      const error = new Error('Not found')
      Object.assign(error, { code: 404 })

      expect(client.isNotFoundError(error)).toBe(true)
    })

    it('should return false for non-404 errors', () => {
      client = new KubernetesClient(mockKubeConfig)
      const error = new Error('Server error')
      Object.assign(error, { code: 500 })

      expect(client.isNotFoundError(error)).toBe(false)
    })

    it('should return false for errors without code property', () => {
      client = new KubernetesClient(mockKubeConfig)
      const error = new Error('Generic error')

      expect(client.isNotFoundError(error)).toBe(false)
    })

    it('should return false for non-Error values', () => {
      client = new KubernetesClient(mockKubeConfig)

      expect(client.isNotFoundError('string error')).toBe(false)
      expect(client.isNotFoundError(null)).toBe(false)
      expect(client.isNotFoundError(undefined)).toBe(false)
    })
  })

  describe('discoverIngressURL', () => {
    it('should discover URL from ingress with HTTPS', async () => {
      mockNetworkingApi.listNamespacedIngress.mockResolvedValue(
        mockIngressWithTLS
      )

      client = new KubernetesClient(mockKubeConfig)
      const url = await client.discoverIngressURL('default')

      expect(url).toBe('https://example.com')
      expect(core.info).toHaveBeenCalledWith(
        '✅ Application URL discovered: https://example.com'
      )
    })

    it('should discover URL from ingress without HTTPS', async () => {
      mockNetworkingApi.listNamespacedIngress.mockResolvedValue(
        mockIngressWithoutTLS
      )

      client = new KubernetesClient(mockKubeConfig)
      const url = await client.discoverIngressURL('default')

      expect(url).toBe('http://example.com')
    })

    it('should use label selector when provided', async () => {
      mockNetworkingApi.listNamespacedIngress.mockResolvedValue(
        mockIngressWithoutTLS
      )

      client = new KubernetesClient(mockKubeConfig)
      await client.discoverIngressURL('default', 'app=test')

      expect(mockNetworkingApi.listNamespacedIngress).toHaveBeenCalledWith({
        namespace: 'default',
        labelSelector: 'app=test'
      })
    })

    it('should return undefined when no ingresses found', async () => {
      const mockIngress = { items: [] }

      mockNetworkingApi.listNamespacedIngress.mockResolvedValue(mockIngress)

      client = new KubernetesClient(mockKubeConfig)
      const url = await client.discoverIngressURL('default')

      expect(url).toBeUndefined()
      expect(core.info).toHaveBeenCalledWith(
        'No ingress resources found in namespace default'
      )
    })

    it('should warn when multiple ingresses found without selector', async () => {
      mockNetworkingApi.listNamespacedIngress.mockResolvedValue(
        mockMultipleIngresses
      )

      client = new KubernetesClient(mockKubeConfig)
      const url = await client.discoverIngressURL('default')

      expect(url).toBe('http://example1.com')
      expect(core.warning).toHaveBeenCalledWith(
        'Found 2 ingress resources in namespace default. ' +
          'Consider using a label selector to choose a specific ingress.'
      )
      expect(core.info).toHaveBeenCalledWith('Using first ingress: ingress-1')
    })

    it('should not warn when multiple ingresses found with selector', async () => {
      mockNetworkingApi.listNamespacedIngress.mockResolvedValue(
        mockMultipleIngresses
      )

      client = new KubernetesClient(mockKubeConfig)
      await client.discoverIngressURL('default', 'app=test')

      expect(core.warning).not.toHaveBeenCalledWith(
        expect.stringContaining('Consider using a label selector')
      )
      expect(core.info).toHaveBeenCalledWith('Label selector used: app=test')
    })

    it('should return undefined when ingress has no host', async () => {
      mockNetworkingApi.listNamespacedIngress.mockResolvedValue(
        mockIngressNoHost
      )

      client = new KubernetesClient(mockKubeConfig)
      const url = await client.discoverIngressURL('default')

      expect(url).toBeUndefined()
      expect(core.warning).toHaveBeenCalledWith(
        "Ingress 'test-ingress' found but no host configured"
      )
    })

    it('should return undefined when API call fails', async () => {
      mockNetworkingApi.listNamespacedIngress.mockRejectedValue(
        new Error('API error')
      )

      client = new KubernetesClient(mockKubeConfig)
      const url = await client.discoverIngressURL('default')

      expect(url).toBeUndefined()
      expect(core.warning).toHaveBeenCalledWith(
        'Failed to discover application URL: API error'
      )
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as k8s from '@kubernetes/client-node'
import { verifyKubernetesAccess } from '../src/kubernetes-access'

vi.mock('../src/constants.js', () => ({
  FLUXCD_NAMESPACE: 'infra-fluxcd'
}))

interface MockAuthApi {
  createSelfSubjectReview: ReturnType<typeof vi.fn>
}

interface MockCustomApi {
  listNamespacedCustomObject: ReturnType<typeof vi.fn>
}

describe('k8s-connectivity', () => {
  let mockKubeConfig: k8s.KubeConfig
  let mockAuthApi: MockAuthApi
  let mockCustomApi: MockCustomApi

  const mockAuthResponse = {
    status: {
      userInfo: {
        username: 'test-user'
      }
    }
  }

  const mockAuthResponseNoUsername = {
    status: {
      userInfo: {}
    }
  }

  const mockContexts = [{ name: 'test-context' }, { name: 'other-context' }]

  const forbiddenError = Object.assign(new Error('Forbidden'), {
    statusCode: 403
  })
  const serverError = Object.assign(new Error('Internal Server Error'), {
    statusCode: 500
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'startGroup').mockImplementation(() => {})
    vi.spyOn(core, 'endGroup').mockImplementation(() => {})
    vi.spyOn(core, 'info').mockImplementation(() => {})
    vi.spyOn(core, 'error').mockImplementation(() => {})

    mockAuthApi = {
      createSelfSubjectReview: vi.fn()
    }

    mockCustomApi = {
      listNamespacedCustomObject: vi.fn()
    }

    mockKubeConfig = {
      loadFromDefault: vi.fn(),
      getContexts: vi.fn(),
      setCurrentContext: vi.fn(),
      makeApiClient: vi.fn((apiType: unknown) => {
        if (apiType === k8s.AuthenticationV1Api) return mockAuthApi
        if (apiType === k8s.CustomObjectsApi) return mockCustomApi
        return null
      })
    } as unknown as k8s.KubeConfig

    vi.spyOn(k8s, 'KubeConfig').mockImplementation(function () {
      return mockKubeConfig
    })
  })

  describe('verifyKubernetesConnectivity', () => {
    it('should successfully verify connectivity', async () => {
      mockKubeConfig.getContexts = vi.fn().mockReturnValue(mockContexts)

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(mockAuthResponse)

      mockCustomApi.listNamespacedCustomObject.mockResolvedValue({
        items: []
      })

      const result = await verifyKubernetesAccess('test-context')

      expect(result).toBe(mockKubeConfig)
      expect(mockKubeConfig.loadFromDefault).toHaveBeenCalled()
      expect(mockKubeConfig.setCurrentContext).toHaveBeenCalledWith(
        'test-context'
      )
      expect(core.info).toHaveBeenCalledWith('Using context: test-context')
      expect(core.info).toHaveBeenCalledWith(
        '✅ Successfully authenticated as: test-user'
      )
      expect(core.info).toHaveBeenCalledWith(
        '✅ Can list OCIRepository resources in infra-fluxcd'
      )
      expect(core.info).toHaveBeenCalledWith(
        '✅ Can list Kustomization resources in infra-fluxcd'
      )
      expect(core.info).toHaveBeenCalledWith(
        '✅ Successfully connected to cluster with required permissions'
      )
    })

    it('should throw error when context does not exist', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'context-1' }, { name: 'context-2' }])

      await expect(
        verifyKubernetesAccess('non-existent-context')
      ).rejects.toThrow("Context 'non-existent-context' does not exist")

      expect(core.error).toHaveBeenCalledWith(
        "Cannot find context 'non-existent-context' in kubeconfig. Available contexts:"
      )
      expect(core.info).toHaveBeenCalledWith('  - context-1')
      expect(core.info).toHaveBeenCalledWith('  - context-2')
    })

    it('should handle authentication failure', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockRejectedValue(
        new Error('Unauthorized')
      )

      await expect(verifyKubernetesAccess('test-context')).rejects.toThrow(
        "Cannot connect to the cluster using context 'test-context'"
      )
    })

    it('should handle missing username in auth response', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(
        mockAuthResponseNoUsername
      )

      mockCustomApi.listNamespacedCustomObject.mockResolvedValue({
        items: []
      })

      await verifyKubernetesAccess('test-context')

      expect(core.info).toHaveBeenCalledWith(
        '✅ Successfully authenticated as: authenticated user'
      )
    })

    it('should throw error on 403 for OCIRepository permissions', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(mockAuthResponse)

      mockCustomApi.listNamespacedCustomObject.mockRejectedValueOnce(
        forbiddenError
      )

      await expect(verifyKubernetesAccess('test-context')).rejects.toThrow(
        'Insufficient permissions to list OCIRepository resources in namespace infra-fluxcd'
      )
    })

    it('should throw error on 403 for Kustomization permissions', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(mockAuthResponse)

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [] })
        .mockRejectedValueOnce(forbiddenError)

      await expect(verifyKubernetesAccess('test-context')).rejects.toThrow(
        'Insufficient permissions to list Kustomization resources in namespace infra-fluxcd'
      )
    })

    it('should re-throw non-403 errors for OCIRepository', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(mockAuthResponse)

      mockCustomApi.listNamespacedCustomObject.mockRejectedValueOnce(
        serverError
      )

      await expect(verifyKubernetesAccess('test-context')).rejects.toThrow(
        'Internal Server Error'
      )
    })

    it('should re-throw non-403 errors for Kustomization', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(mockAuthResponse)

      mockCustomApi.listNamespacedCustomObject
        .mockResolvedValueOnce({ items: [] })
        .mockRejectedValueOnce(serverError)

      await expect(verifyKubernetesAccess('test-context')).rejects.toThrow(
        'Internal Server Error'
      )
    })

    it('should handle errors without statusCode property', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(mockAuthResponse)

      mockCustomApi.listNamespacedCustomObject.mockRejectedValueOnce(
        new Error('Generic error')
      )

      await expect(verifyKubernetesAccess('test-context')).rejects.toThrow(
        'Generic error'
      )
    })

    it('should verify both OCIRepository and Kustomization permissions', async () => {
      mockKubeConfig.getContexts = vi
        .fn()
        .mockReturnValue([{ name: 'test-context' }])

      mockAuthApi.createSelfSubjectReview.mockResolvedValue(mockAuthResponse)

      mockCustomApi.listNamespacedCustomObject.mockResolvedValue({
        items: []
      })

      await verifyKubernetesAccess('test-context')

      expect(mockCustomApi.listNamespacedCustomObject).toHaveBeenCalledTimes(2)
      expect(mockCustomApi.listNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'source.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'ocirepositories',
        limit: 1
      })
      expect(mockCustomApi.listNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'kustomize.toolkit.fluxcd.io',
        version: 'v1',
        namespace: 'infra-fluxcd',
        plural: 'kustomizations',
        limit: 1
      })
    })
  })
})

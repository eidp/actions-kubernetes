import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as github from '@actions/github'
import * as k8s from '@kubernetes/client-node'
import {
  readTenantsReplacementConfig,
  createOCIRepository,
  createKustomization
} from '../src/k8s-operations.js'
import { KubernetesClient, FluxClient } from '@actions-kubernetes/k8s-client'

vi.mock('@actions/core')
vi.mock('@actions-kubernetes/k8s-client')

describe('k8s-operations', () => {
  let mockKubeConfig: k8s.KubeConfig

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(core, 'info').mockImplementation(() => {})

    mockKubeConfig = {} as k8s.KubeConfig

    Object.defineProperty(github, 'context', {
      value: {
        repo: { owner: 'test-owner', repo: 'test-repo' }
      },
      writable: true,
      configurable: true
    })
  })

  describe('readTenantsReplacementConfig', () => {
    it('should read and return tenant replacement config', async () => {
      const mockConfigMap = {
        data: {
          instanceName: 'test-instance',
          clusterName: 'test-cluster',
          objectStoreEndpoint: 'https://s3.example.com'
        }
      }

      vi.mocked(KubernetesClient).mockImplementation(function () {
        return {
          readConfigMap: vi.fn().mockResolvedValue(mockConfigMap)
        } as unknown as KubernetesClient
      })

      const result = await readTenantsReplacementConfig(mockKubeConfig)

      expect(result).toEqual({
        instanceName: 'test-instance',
        clusterName: 'test-cluster',
        objectStoreEndpoint: 'https://s3.example.com'
      })
      expect(core.info).toHaveBeenCalledWith(
        'Read tenant replacement config: instanceName=test-instance, clusterName=test-cluster, objectStoreEndpoint=https://s3.example.com'
      )
    })

    it('should throw error when ConfigMap has no data section', async () => {
      const mockConfigMap = {}

      vi.mocked(KubernetesClient).mockImplementation(function () {
        return {
          readConfigMap: vi.fn().mockResolvedValue(mockConfigMap)
        } as unknown as KubernetesClient
      })

      await expect(
        readTenantsReplacementConfig(mockKubeConfig)
      ).rejects.toThrow(
        "ConfigMap 'tenants-replacement-config' has no data section"
      )
    })

    it('should throw error when ConfigMap is missing required keys', async () => {
      const mockConfigMap = {
        data: {
          instanceName: 'test-instance'
          // Missing clusterName and objectStoreEndpoint
        }
      }

      vi.mocked(KubernetesClient).mockImplementation(function () {
        return {
          readConfigMap: vi.fn().mockResolvedValue(mockConfigMap)
        } as unknown as KubernetesClient
      })

      await expect(
        readTenantsReplacementConfig(mockKubeConfig)
      ).rejects.toThrow(
        "ConfigMap 'tenants-replacement-config' is missing required keys: clusterName, objectStoreEndpoint"
      )
    })

    it('should wrap errors with context', async () => {
      vi.mocked(KubernetesClient).mockImplementation(function () {
        return {
          readConfigMap: vi
            .fn()
            .mockRejectedValue(new Error('ConfigMap not found'))
        } as unknown as KubernetesClient
      })

      await expect(
        readTenantsReplacementConfig(mockKubeConfig)
      ).rejects.toThrow(
        "Failed to read ConfigMap 'tenants-replacement-config' from namespace 'infra-fluxcd': ConfigMap not found"
      )
    })
  })

  describe('createOCIRepository', () => {
    it('should create OCIRepository with correct labels and spec', async () => {
      const mockCreateOCIRepository = vi.fn()
      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          createOCIRepository: mockCreateOCIRepository
        } as unknown as FluxClient
      })

      await createOCIRepository(mockKubeConfig, {
        name: 'test-oci-repo',
        tenantName: 'my-tenant',
        reference: 'pr-123',
        environment: 'preview-123',
        prNumber: 123
      })

      expect(mockCreateOCIRepository).toHaveBeenCalledWith(
        expect.objectContaining({
          apiVersion: 'source.toolkit.fluxcd.io/v1',
          kind: 'OCIRepository',
          metadata: expect.objectContaining({
            name: 'test-oci-repo',
            namespace: 'infra-fluxcd',
            labels: expect.objectContaining({
              'app.kubernetes.io/managed-by': 'github-actions',
              'app.kubernetes.io/created-by': 'deploy-preview',
              'eidp.io/preview-deployment': 'true',
              'eidp.io/ci-reference': 'pr-123',
              'eidp.io/repository': 'test-owner_test-repo',
              'eidp.io/environment': 'preview-123',
              'eidp.io/pull-request': '123'
            })
          }),
          spec: {
            interval: '5m',
            url: 'oci://cr.eidp.io/tenant-definitions/my-tenant',
            ref: {
              tag: 'latest'
            },
            secretRef: {
              name: 'eidp-harbor-pull-credential'
            }
          }
        }),
        'deploy-preview-action'
      )

      expect(core.info).toHaveBeenCalledWith(
        'Creating OCIRepository: test-oci-repo'
      )
    })

    it('should handle null PR number', async () => {
      const mockCreateOCIRepository = vi.fn()
      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          createOCIRepository: mockCreateOCIRepository
        } as unknown as FluxClient
      })

      await createOCIRepository(mockKubeConfig, {
        name: 'test-oci-repo',
        tenantName: 'my-tenant',
        reference: 'branch-main',
        environment: 'dev',
        prNumber: null
      })

      expect(mockCreateOCIRepository).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            labels: expect.objectContaining({
              'eidp.io/pull-request': ''
            })
          })
        }),
        'deploy-preview-action'
      )
    })
  })

  describe('createKustomization', () => {
    it('should create Kustomization with correct spec and labels', async () => {
      const mockCreateKustomization = vi.fn()
      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          createKustomization: mockCreateKustomization
        } as unknown as FluxClient
      })

      await createKustomization(mockKubeConfig, {
        name: 'test-kust',
        ociRepoName: 'test-oci-repo',
        tenantName: 'my-tenant',
        reference: 'pr-123',
        ciPrefix: 'ci-pr-123-',
        namespace: 'ci-pr-123-my-tenant',
        environment: 'preview-123',
        gitBranch: 'feature/test',
        gitOrganisation: 'test-owner',
        gitRepository: 'test-repo',
        timeout: '5m',
        instanceName: 'test-instance',
        clusterName: 'test-cluster',
        objectStoreEndpoint: 'https://s3.example.com'
      })

      expect(mockCreateKustomization).toHaveBeenCalledWith(
        expect.objectContaining({
          apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
          kind: 'Kustomization',
          metadata: expect.objectContaining({
            name: 'test-kust',
            namespace: 'infra-fluxcd',
            labels: expect.objectContaining({
              'app.kubernetes.io/managed-by': 'github-actions',
              'app.kubernetes.io/created-by': 'deploy-preview',
              'eidp.io/preview-deployment': 'true',
              'eidp.io/ci-reference': 'pr-123',
              'eidp.io/repository': 'test-owner_test-repo',
              'eidp.io/environment': 'preview-123'
            })
          }),
          spec: {
            serviceAccountName: 'flux-deployment-controller',
            interval: '10m',
            sourceRef: {
              kind: 'OCIRepository',
              name: 'test-oci-repo'
            },
            path: './',
            prune: true,
            wait: true,
            timeout: '5m',
            postBuild: {
              substitute: {
                instanceName: 'test-instance',
                clusterName: 'test-cluster',
                environmentName: 'preview-123',
                helmReleaseName: 'ci-pr-123-my-tenant',
                releaseName: 'ci-pr-123-my-tenant-tenant',
                gitBranch: 'feature/test',
                gitRepository: 'test-repo',
                gitOrganisation: 'test-owner',
                namespace: 'ci-pr-123-my-tenant',
                namePrefix: 'ci-pr-123-',
                objectStoreEndpoint: 'https://s3.example.com'
              }
            }
          }
        }),
        'deploy-preview-action'
      )

      expect(core.info).toHaveBeenCalledWith(
        'Deploying preview tenant: test-kust'
      )
    })

    it('should include chart version in postBuild substitutions when provided', async () => {
      const mockCreateKustomization = vi.fn()
      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          createKustomization: mockCreateKustomization
        } as unknown as FluxClient
      })

      await createKustomization(mockKubeConfig, {
        name: 'test-kust',
        ociRepoName: 'test-oci-repo',
        tenantName: 'my-tenant',
        reference: 'pr-123',
        ciPrefix: 'ci-pr-123-',
        namespace: 'ci-pr-123-my-tenant',
        environment: 'preview-123',
        gitBranch: 'feature/test',
        gitRepository: 'test-repo',
        gitOrganisation: 'test-owner',
        chartVersion: '1.2.3',
        timeout: '5m',
        instanceName: 'test-instance',
        clusterName: 'test-cluster',
        objectStoreEndpoint: 'https://s3.example.com'
      })

      const callArg = mockCreateKustomization.mock.calls[0][0]
      expect(callArg.spec.postBuild.substitute).toHaveProperty(
        'appChartVersion',
        '1.2.3'
      )
    })

    it('should not include chart version when not provided', async () => {
      const mockCreateKustomization = vi.fn()
      vi.mocked(FluxClient).mockImplementation(function () {
        return {
          createKustomization: mockCreateKustomization
        } as unknown as FluxClient
      })

      await createKustomization(mockKubeConfig, {
        name: 'test-kust',
        ociRepoName: 'test-oci-repo',
        tenantName: 'my-tenant',
        reference: 'pr-123',
        ciPrefix: 'ci-pr-123-',
        namespace: 'ci-pr-123-my-tenant',
        environment: 'preview-123',
        gitBranch: 'feature/test',
        gitRepository: 'test-repo',
        gitOrganisation: 'test-owner',
        timeout: '5m',
        instanceName: 'test-instance',
        clusterName: 'test-cluster',
        objectStoreEndpoint: 'https://s3.example.com'
      })

      const callArg = mockCreateKustomization.mock.calls[0][0]
      expect(callArg.spec.postBuild.substitute).not.toHaveProperty(
        'appChartVersion'
      )
    })
  })
})

// Mock for @kubernetes/client-node
import { vi } from 'vitest'

export class KubeConfig {
  loadFromDefault = vi.fn()
  getContexts = vi.fn()
  setCurrentContext = vi.fn()
  makeApiClient = vi.fn()
}

export class Watch {
  watch = vi.fn()
}

export class CoreV1Api {}
export class CustomObjectsApi {}
export class AuthenticationV1Api {}
export class AuthorizationV1Api {}

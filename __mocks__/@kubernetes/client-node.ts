// Mock for @kubernetes/client-node

export class KubeConfig {
  loadFromDefault = jest.fn()
  getContexts = jest.fn()
  setCurrentContext = jest.fn()
  makeApiClient = jest.fn()
}

export class Watch {
  watch = jest.fn()
}

export class CoreV1Api {}
export class CustomObjectsApi {}
export class AuthenticationV1Api {}
export class AuthorizationV1Api {}

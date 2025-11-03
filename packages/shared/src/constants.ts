// ANSI color codes for terminal output
export const ANSI_RED = '\x1b[1;31m'
export const ANSI_RESET = '\x1b[0m'

/**
 * Kubernetes namespace where FluxCD is installed
 */
export const FLUXCD_NAMESPACE = 'infra-fluxcd'

/**
 * Name of the ConfigMap containing the tenant replacement configuration
 */
export const TENANT_REPLACEMENT_CONFIG = 'tenants-replacement-config'

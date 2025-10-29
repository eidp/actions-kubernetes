// ANSI color codes for terminal output
export const ANSI_RED = '\x1b[1;31m'
export const ANSI_RESET = '\x1b[0m'

/**
 * Kubernetes label constants used across actions
 */
export const Labels = {
  MANAGED_BY: 'app.kubernetes.io/managed-by',
  CREATED_BY: 'app.kubernetes.io/created-by',
  PREVIEW_DEPLOYMENT: 'eidp.io/preview-deployment',
  CI_REFERENCE: 'eidp.io/ci-reference',
  REPOSITORY: 'eidp.io/repository',
  ENVIRONMENT: 'eidp.io/environment'
} as const

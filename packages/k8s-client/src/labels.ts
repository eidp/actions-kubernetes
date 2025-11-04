/**
 * Kubernetes label constants used across actions
 */
export const Labels = {
  MANAGED_BY: 'app.kubernetes.io/managed-by',
  CREATED_BY: 'app.kubernetes.io/created-by',
  PREVIEW_DEPLOYMENT: 'eidp.io/preview-deployment',
  CI_REFERENCE: 'eidp.io/ci-reference',
  REPOSITORY: 'eidp.io/repository',
  ENVIRONMENT: 'eidp.io/environment',
  PR: 'eidp.io/pull-request'
} as const

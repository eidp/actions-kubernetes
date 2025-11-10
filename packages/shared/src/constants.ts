// ANSI color codes for terminal output
export const ANSI_RED = '\x1b[1;31m'
export const ANSI_RESET = '\x1b[0m'

/**
 * Status emojis for deployment comments
 */
export const STATUS_EMOJI = {
  deployed: '🚀',
  verified: '✅',
  failed: '❌'
} as const

/**
 * Status titles for deployment comments
 */
export const STATUS_TITLE = {
  deployed: 'Deployment created',
  verified: 'Deployment ready',
  failed: 'Deployment failed'
} as const

/**
 * Status description templates for deployment comments
 */
export const STATUS_DESCRIPTION = {
  deployed: (environment: string) =>
    `Environment \`${environment}\` has been created successfully. Your application is now being deployed.`,
  verified: (environment: string) =>
    `Your application has been deployed to environment \`${environment}\` and is ready to use.`,
  failed: (environment: string) =>
    `Failed to create or verify your application in environment \`${environment}\`.`
} as const

/**
 * Teardown reason types
 */
export enum TeardownReason {
  Manual = 'manual',
  PrClosed = 'pr-closed',
  Scheduled = 'scheduled'
}

/**
 * Teardown message templates based on reason
 */
export const TEARDOWN_MESSAGE = {
  [TeardownReason.Manual]: (environment: string) =>
    `Environment \`${environment}\` has been manually torn down via the \`/teardown\` command.`,
  [TeardownReason.PrClosed]: (environment: string) =>
    `Environment \`${environment}\` has been automatically torn down because the PR was closed.`,
  [TeardownReason.Scheduled]: (environment: string) =>
    `Environment \`${environment}\` was automatically torn down because the configured timeout has passed.`
} as const

/**
 * Teardown tips based on reason
 */
export const TEARDOWN_TIP = {
  [TeardownReason.Manual]: null,
  [TeardownReason.PrClosed]: null,
  [TeardownReason.Scheduled]:
    '💡 **Tip:** To keep an environment, add the `keep-preview` label to your PR.'
} as const

export function getTeardownStatusMessage(reason: TeardownReason): string {
  switch (reason) {
    case TeardownReason.Manual:
      return 'Environment manually torn down'
    case TeardownReason.PrClosed:
      return 'Environment torn down (PR closed)'
    case TeardownReason.Scheduled:
      return 'Environment torn down (scheduled cleanup)'
  }
}

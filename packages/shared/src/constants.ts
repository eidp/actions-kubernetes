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

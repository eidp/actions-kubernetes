import * as core from '@actions/core'

/**
 * Sanitizes a string for use as a Kubernetes resource name.
 * Converts to lowercase and removes all characters except alphanumeric and hyphens.
 */
export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/**
 * Sanitizes a string for use as a Kubernetes label value.
 * Kubernetes label values must:
 * - Be 63 characters or less
 * - Contain only alphanumeric characters, hyphens, underscores, and dots
 * - Start and end with an alphanumeric character
 */
export function sanitizeLabelValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .substring(0, 63)
    .replace(/[^a-z0-9]+$/, '')
}

/**
 * Truncates a name to a maximum length, logging a warning if truncation occurs.
 */
export function truncateName(name: string, maxLength: number = 63): string {
  if (name.length > maxLength) {
    core.warning(`Name truncated to ${maxLength} characters: ${name}`)
    return name.substring(0, maxLength)
  }
  return name
}

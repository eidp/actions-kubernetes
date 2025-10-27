import * as core from '@actions/core'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export function sanitizeLabelValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .substring(0, 63)
    .replace(/[^a-z0-9]+$/, '')
}

export function truncateName(name: string, maxLength: number = 63): string {
  if (name.length > maxLength) {
    core.warning(`Name truncated to ${maxLength} characters: ${name}`)
    return name.substring(0, maxLength)
  }
  return name
}

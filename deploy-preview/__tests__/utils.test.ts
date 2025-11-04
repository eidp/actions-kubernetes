import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sleep } from '../src/utils.js'

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should resolve after the specified time', async () => {
    const promise = sleep(1000)

    expect(promise).toBeInstanceOf(Promise)

    vi.advanceTimersByTime(999)
    await Promise.resolve()

    let resolved = false
    promise.then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    vi.advanceTimersByTime(1)
    await promise
    expect(resolved).toBe(true)
  })

  it('should handle zero milliseconds', async () => {
    const promise = sleep(0)

    vi.advanceTimersByTime(0)
    const result = await promise

    expect(result).toBeUndefined()
  })

  it('should handle large timeouts', async () => {
    const promise = sleep(60000)

    vi.advanceTimersByTime(59999)
    await Promise.resolve()

    let resolved = false
    promise.then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    vi.advanceTimersByTime(1)
    await promise
    expect(resolved).toBe(true)
  })

  it('should resolve with undefined', async () => {
    const promise = sleep(100)
    vi.advanceTimersByTime(100)
    const result = await promise
    expect(result).toBeUndefined()
  })

  it('should work with multiple concurrent sleep calls', async () => {
    const sleep1 = sleep(100)
    const sleep2 = sleep(200)
    const sleep3 = sleep(300)

    vi.advanceTimersByTime(100)
    const result1 = await sleep1

    vi.advanceTimersByTime(100)
    const result2 = await sleep2

    vi.advanceTimersByTime(100)
    const result3 = await sleep3

    expect(result1).toBeUndefined()
    expect(result2).toBeUndefined()
    expect(result3).toBeUndefined()
  })
})

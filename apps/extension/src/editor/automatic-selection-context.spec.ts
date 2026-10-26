import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomaticSelectionContext } from './automatic-selection-context.js'

afterEach(() => vi.useRealTimers())

describe('automatic selected-code context', () => {
  it('aborts an in-flight capture when selection changes and ignores its late completion', async () => {
    vi.useFakeTimers()
    let key = 'first'
    const captures: Array<{ signal: AbortSignal; complete: () => void }> = []
    const capture = vi.fn(
      (signal: AbortSignal) => new Promise<void>((resolve) => captures.push({ signal, complete: resolve })),
    )
    const onError = vi.fn()
    const automatic = new AutomaticSelectionContext({ selectionKey: () => key, capture, onError })
    automatic.schedule()
    await vi.runAllTimersAsync()
    key = 'second'
    automatic.schedule()
    expect(captures[0]?.signal.aborted).toBe(true)
    captures[0]?.complete()
    await vi.runAllTimersAsync()
    expect(capture).toHaveBeenCalledTimes(2)
    automatic.dispose()
    expect(captures[1]?.signal.aborted).toBe(true)
    captures[1]?.complete()
    await Promise.resolve()
    expect(onError).not.toHaveBeenCalled()
  })

  it('debounces dragging, deduplicates unchanged selections, and can reset after workspace changes', async () => {
    vi.useFakeTimers()
    let key: string | undefined
    const capture = vi.fn().mockResolvedValue(undefined)
    const automatic = new AutomaticSelectionContext({ selectionKey: () => key, capture, onError: vi.fn() })
    automatic.schedule()
    await vi.runAllTimersAsync()
    expect(capture).not.toHaveBeenCalled()
    key = 'first range'
    automatic.schedule()
    await vi.advanceTimersByTimeAsync(100)
    key = 'final range'
    automatic.schedule()
    await vi.runAllTimersAsync()
    expect(capture).toHaveBeenCalledOnce()
    automatic.schedule()
    await vi.runAllTimersAsync()
    expect(capture).toHaveBeenCalledOnce()
    automatic.reset()
    automatic.schedule()
    await vi.runAllTimersAsync()
    expect(capture).toHaveBeenCalledTimes(2)
    automatic.dispose()
  })

  it('cancels pending work when selection disappears or the host is disposed, and reports real failures', async () => {
    vi.useFakeTimers()
    let key: string | undefined = 'range'
    let signal: AbortSignal | undefined
    const capture = vi.fn((input: AbortSignal) => {
      signal = input
      return Promise.reject(new Error('unavailable'))
    })
    const onError = vi.fn()
    const automatic = new AutomaticSelectionContext({ selectionKey: () => key, capture, onError })
    automatic.schedule()
    key = undefined
    automatic.schedule()
    await vi.runAllTimersAsync()
    expect(capture).not.toHaveBeenCalled()
    key = 'range'
    automatic.schedule()
    await vi.runAllTimersAsync()
    expect(onError).toHaveBeenCalledOnce()
    automatic.dispose()
    expect(signal?.aborted).toBe(true)
    automatic.schedule()
    await vi.runAllTimersAsync()
    expect(capture).toHaveBeenCalledOnce()
  })
})

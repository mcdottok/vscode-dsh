import { afterEach, expect, it, vi } from 'vitest'
import { AppError } from '@dsh-vscode/domain'
import { canRecoverDesktop, desktopRecoveryState, withDesktopRecovery } from './desktop-recovery.js'

afterEach(() => vi.useRealTimers())
const unavailable = (): AppError =>
  new AppError({ code: 'BACKEND_UNREACHABLE', message: 'Unavailable', retryable: true })

it('limits automatic recovery to default discovery and local saved addresses', () => {
  expect(canRecoverDesktop({ mode: 'attach-only' })).toBe(true)
  expect(canRecoverDesktop({ mode: 'custom', serverUrl: 'http://127.0.0.1:43120' })).toBe(true)
  expect(canRecoverDesktop({ mode: 'custom', serverUrl: 'https://example.com' })).toBe(false)
  expect(canRecoverDesktop({ mode: 'new-isolated' })).toBe(false)
  expect(canRecoverDesktop({ mode: 'auto', attachPortsConfigured: true })).toBe(false)
  expect(canRecoverDesktop({ mode: 'custom', serverUrl: 'invalid' })).toBe(false)
})

it('refreshes address and credentials before retrying, with one recovery window', async () => {
  vi.useFakeTimers()
  const connect = vi.fn().mockRejectedValueOnce(unavailable()).mockResolvedValue('connected')
  const refresh = vi.fn().mockResolvedValue(undefined)
  const active = vi.fn()
  const result = withDesktopRecovery({ connect, refresh, active })
  await vi.advanceTimersByTimeAsync(750)
  expect(await result).toBe('connected')
  expect(connect).toHaveBeenCalledTimes(2)
  expect(refresh).toHaveBeenCalledOnce()
  expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(connect.mock.invocationCallOrder[1]!)
  expect(active.mock.calls).toEqual([[true], [false]])
})

it('surfaces the final failure after the restart grace window and leaves no retry timer', async () => {
  vi.useFakeTimers()
  const connect = vi.fn().mockRejectedValue(unavailable())
  const active = vi.fn()
  const result = withDesktopRecovery({ connect, refresh: async () => {}, active })
  const failure = expect(result).rejects.toMatchObject({ code: 'BACKEND_UNREACHABLE' })
  await vi.runAllTimersAsync()
  await failure
  expect(connect).toHaveBeenCalledTimes(5)
  expect(vi.getTimerCount()).toBe(0)
  expect(active.mock.calls).toEqual([[true], [false]])
})

it('cancels a delayed retry without refreshing credentials or publishing a failure', async () => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const refresh = vi.fn()
  const active = vi.fn()
  const result = withDesktopRecovery({
    connect: () => Promise.reject(unavailable()),
    refresh,
    active,
    signal: abort.signal,
  })
  const failure = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(0)
  abort.abort()
  await failure
  expect(refresh).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(active.mock.calls).toEqual([[true], [false]])
})

it('does not retry protocol incompatibility and only suppresses transient failure presentation', async () => {
  const failure = new AppError({
    code: 'DSH_INCOMPATIBLE',
    message: 'Unsupported protocol',
    retryable: false,
  })
  const refresh = vi.fn()
  await expect(
    withDesktopRecovery({ connect: () => Promise.reject(failure), refresh, active: () => {} }),
  ).rejects.toBe(failure)
  expect(refresh).not.toHaveBeenCalled()
  const state = { kind: 'failed' as const, message: 'Unavailable', retryable: true }
  expect(desktopRecoveryState(state, true)).toMatchObject({ kind: 'discovering' })
  expect(desktopRecoveryState(state, false)).toBe(state)
})

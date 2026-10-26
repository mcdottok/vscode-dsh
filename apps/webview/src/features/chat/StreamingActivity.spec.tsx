// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setActiveLocale, translate } from '../../i18n.js'
import { StreamingActivity } from './StreamingActivity.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setActiveLocale('en')
})

describe('streaming activity clock', () => {
  it('uses the DSH start time after delayed mount, remount and late timestamp recovery', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const view = render(<StreamingActivity startedAt={46_000} translate={translate} />)
    expect(screen.getByRole('status').textContent).toBe('Responding, 54s elapsed…')
    view.rerender(<StreamingActivity key="remounted" startedAt={46_000} usingTool translate={translate} />)
    expect(screen.getByRole('status').textContent).toBe('Using a tool, 54s elapsed…')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByRole('status').textContent).toBe('Using a tool, 55s elapsed…')
    view.rerender(<StreamingActivity key="new" translate={translate} />)
    expect(screen.getByRole('status').textContent).toBe('Responding, 0s elapsed…')
    view.rerender(<StreamingActivity key="new" startedAt={46_000} translate={translate} />)
    expect(screen.getByRole('status').textContent).toBe('Responding, 55s elapsed…')
    view.rerender(<StreamingActivity key="future" startedAt={200_000} translate={translate} />)
    expect(screen.getByRole('status').textContent).toBe('Responding, 0s elapsed…')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains elapsed time across tool phases, formats minutes, and resets for a new turn', () => {
    vi.useFakeTimers()
    const view = render(<StreamingActivity key="turn-1" translate={translate} />)
    act(() => {
      vi.advanceTimersByTime(43_000)
    })
    expect(screen.getByRole('status').textContent).toBe('Responding, 43s elapsed…')
    expect(screen.getByText(', 43s elapsed…').getAttribute('aria-hidden')).toBe('true')
    view.rerender(<StreamingActivity key="turn-1" usingTool translate={translate} />)
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(screen.getByRole('status').textContent).toBe('Using a tool, 1m 3s elapsed…')
    view.rerender(<StreamingActivity key="turn-2" translate={translate} />)
    expect(screen.getByRole('status').textContent).toBe('Responding, 0s elapsed…')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses hidden polling, catches up when visible, and disposes the visibility listener', () => {
    vi.useFakeTimers()
    let visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility as DocumentVisibilityState,
    )
    const removed = vi.spyOn(document, 'removeEventListener')
    setActiveLocale('zh')
    const view = render(<StreamingActivity translate={translate} />)
    visibility = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('status').textContent).toBe('深度求索中，用时 1 分钟 5 秒…')
    view.unmount()
    expect(removed).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})

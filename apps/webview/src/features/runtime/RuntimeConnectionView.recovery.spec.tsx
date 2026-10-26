// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeConnectionView } from './RuntimeConnectionView.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('connection recovery screen', () => {
  it('bounds a stalled connection step, permits retry and clears its timer on disposal', async () => {
    vi.useFakeTimers()
    const retry = vi.fn()
    const { container, unmount } = render(
      <RuntimeConnectionView state={{ kind: 'connecting', phase: 'verification' }} onRetry={retry} />,
    )
    await act(() => vi.advanceTimersByTime(29_999))
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    await act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('heading', { name: 'DSH connection timed out' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('Copy a new connection address or retry.')
    expect(container.querySelector('[data-loading]')?.getAttribute('data-loading')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retires the previous step deadline when progress advances or a terminal result arrives', async () => {
    vi.useFakeTimers()
    const { container, rerender } = render(
      <RuntimeConnectionView state={{ kind: 'connecting', phase: 'verification' }} />,
    )
    await act(() => vi.advanceTimersByTime(20_000))
    rerender(<RuntimeConnectionView state={{ kind: 'connecting', phase: 'initialization' }} />)
    await act(() => vi.advanceTimersByTime(20_000))
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    await act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('heading', { name: 'DSH connection timed out' })).toBeDefined()
    rerender(<RuntimeConnectionView state={{ kind: 'idle' }} />)
    expect(vi.getTimerCount()).toBe(0)
    await act(() => vi.advanceTimersByTime(30_000))
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<RuntimeConnectionView state={{ kind: 'connecting', phase: 'initialization' }} />)
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps an idle connection still and offers settings and a new attempt', () => {
    const settings = vi.fn()
    const retry = vi.fn()
    const { container } = render(
      <RuntimeConnectionView
        state={{ kind: 'idle' }}
        onOpenSettings={settings}
        onConnectDesktop={vi.fn()}
        onRetry={retry}
      />,
    )
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('false')
    expect(container.querySelector('[data-loading]')?.getAttribute('data-loading')).toBe('false')
    expect(screen.getByRole('heading', { name: 'DSH is not connected' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Choose connection source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(settings).toHaveBeenCalledOnce()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('shows terminal failure outside collapsed diagnostics and stops its loading indicator', () => {
    const retry = vi.fn()
    const { container, rerender } = render(
      <RuntimeConnectionView state={{ kind: 'connecting' }} onRetry={retry} />,
    )
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
    rerender(
      <RuntimeConnectionView
        state={{ kind: 'failed', retryable: true, message: 'The configured DSH service is unavailable.' }}
        onRetry={retry}
        onOpenSettings={vi.fn()}
        onConnectDesktop={vi.fn()}
      />,
    )
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('heading', { name: 'DSH connection failed' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe('The configured DSH service is unavailable.')
    expect(screen.getByRole('button', { name: 'Diagnostic details' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})

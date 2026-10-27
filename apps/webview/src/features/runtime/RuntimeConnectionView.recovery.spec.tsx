// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppErrorCode, ConnectionLogEntry } from '@dsh-vscode/domain'
import { RuntimeConnectionView } from './RuntimeConnectionView.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('connection recovery screen', () => {
  const failedAttempt = (mode: 'custom' | 'auto', code: AppErrorCode): readonly ConnectionLogEntry[] => [
    { id: 1, time: '2026-10-27T02:44:08.000Z', elapsedMs: 0, phase: 'connect', status: 'started', mode },
    { id: 2, time: '2026-10-27T02:44:09.000Z', elapsedMs: 1000, phase: 'connect', status: 'failed', code },
  ]

  it('explains saved-address recovery and opens the paste prompt directly despite a settings callback', async () => {
    let reject!: (reason: Error) => void
    const connect = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail
        }),
    )
    const settings = vi.fn()
    render(
      <RuntimeConnectionView
        state={{ kind: 'failed', retryable: true, message: 'Configured endpoint unavailable' }}
        output={failedAttempt('custom', 'BACKEND_UNREACHABLE')}
        onConnectDesktop={connect}
        onOpenSettings={settings}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Cannot connect to the saved address' })).toBeDefined()
    expect(screen.getByText(/In Desktop, open Settings → General → VS Code connection/)).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('retrying the old address will not update it')
    const button = screen.getByRole('button', { name: 'Update connection address' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(connect).toHaveBeenCalledOnce()
    expect(settings).not.toHaveBeenCalled()
    expect(button).toHaveProperty('disabled', true)
    act(() => {
      reject(new Error('Fixture rejected'))
    })
    await waitFor(() => expect(button).toHaveProperty('disabled', false))
    expect(
      screen.getByText('Unable to connect to DSH Desktop. Try again or open Output for details.'),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Choose connection source' }))
    expect(settings).toHaveBeenCalledOnce()
  })

  it.each([
    ['custom', 'DSH_INCOMPATIBLE'],
    ['custom', 'AUTH_REQUIRED'],
    ['auto', 'BACKEND_UNREACHABLE'],
  ] as const)('does not relabel %s / %s as a saved-address failure', (mode, code) => {
    render(
      <RuntimeConnectionView
        state={{ kind: 'failed', retryable: true, message: 'Specific failure' }}
        output={failedAttempt(mode, code)}
        onConnectDesktop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Update connection address' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Specific failure')
  })

  it('ignores an old saved-address failure after a new connection attempt', () => {
    render(
      <RuntimeConnectionView
        state={{ kind: 'failed', retryable: false, message: 'New protocol failure' }}
        output={[
          ...failedAttempt('custom', 'BACKEND_UNREACHABLE'),
          ...failedAttempt('custom', 'DSH_INCOMPATIBLE').map((entry) => ({ ...entry, id: entry.id + 2 })),
        ]}
        onConnectDesktop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Update connection address' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('New protocol failure')
  })

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

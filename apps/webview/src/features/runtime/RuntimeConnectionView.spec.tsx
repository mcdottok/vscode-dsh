// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionLogEntry, ExtensionSettingsSummary } from '@dsh-vscode/domain'
import { RuntimeConnectionView } from './RuntimeConnectionView.js'

const first: ConnectionLogEntry = {
  id: 1,
  time: '2026-10-18T05:00:00.000Z',
  elapsedMs: 0,
  phase: 'connect',
  status: 'started',
  mode: 'auto',
}
const found: ConnectionLogEntry = {
  id: 2,
  time: '2026-10-18T05:00:00.230Z',
  elapsedMs: 230,
  phase: 'discovery',
  status: 'succeeded',
  count: 2,
}

function diagnosticLog(): HTMLElement {
  if (screen.queryByRole('log') === null)
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostic details' }))
  return screen.getByRole('log')
}

describe('RuntimeConnectionView', () => {
  it('shows preparation before the first Host snapshot and restores retry when initialization ends', () => {
    const { rerender } = render(
      <RuntimeConnectionView state={{ kind: 'idle' }} initializing onRetry={vi.fn()} />,
    )
    expect(screen.getByRole('progressbar', { name: 'Preparing DSH connection' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    rerender(<RuntimeConnectionView state={{ kind: 'locating-runtime' }} initializing onRetry={vi.fn()} />)
    expect(screen.getByRole('progressbar', { name: 'Looking for DSH' })).toBeDefined()
    rerender(<RuntimeConnectionView state={{ kind: 'idle' }} initializing={false} onRetry={vi.fn()} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })

  it.each([
    ['new-isolated', 'DSH CLI is not connected', 'You are using DSH CLI.'],
    ['custom', 'DSH Desktop is not connected', 'Keep DSH Desktop running with VS Code connection enabled'],
    ['auto', 'DSH Desktop is not connected', 'Keep DSH Desktop running with VS Code connection enabled'],
  ] as const)(
    'reads saved %s settings after reload before any connection log exists',
    async (mode, title, help) => {
      const value: ExtensionSettingsSummary = {
        extensionVersion: '0.1.81',
        connection: { mode, customEndpointConfigured: mode === 'custom' },
        runtime: { customExecutableConfigured: false, autoStart: mode === 'new-isolated' },
        security: { defaultPermissionPreset: 'workspace-write' },
        defaultAgent: {
          preset: 'standard',
          toolMode: 'native',
          permissionPreset: 'workspace-write',
          planMode: false,
          model: { providerId: 'fixture', modelId: 'model' },
        },
      }
      const read = vi.fn().mockResolvedValue(value)
      render(
        <RuntimeConnectionView state={{ kind: 'idle' }} onReadSettings={read} onConnectDesktop={vi.fn()} />,
      )
      expect(
        screen.getByText('Choose a connection source, or retry using your saved settings.'),
      ).toBeDefined()
      await screen.findByRole('heading', { name: title })
      expect(screen.getByText((text) => text.startsWith(help))).toBeDefined()
      expect(read).toHaveBeenCalledOnce()
      if (mode === 'new-isolated')
        expect(
          screen.getByText('Connection source: DSH CLI. The extension starts the local service.'),
        ).toBeDefined()
    },
  )

  it('offers Desktop authorization directly on the disconnected screen and prevents duplicate prompts', async () => {
    let finish!: () => void
    const connect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    render(
      <RuntimeConnectionView
        state={{ kind: 'failed', retryable: true, message: 'Not authorized' }}
        onConnectDesktop={connect}
      />,
    )
    const button = screen.getByRole('button', { name: 'Connect to Desktop' })
    fireEvent.click(button)
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
    expect(connect).toHaveBeenCalledOnce()
    finish()
    await waitFor(() => expect(button).toHaveProperty('disabled', false))
  })
  it('keeps diagnostics collapsed and reveals the complete log on demand', () => {
    const output = [
      first,
      ...Array.from({ length: 7 }, (_, index) => ({ ...found, id: index + 2, count: index + 1 })),
    ]
    const { rerender } = render(<RuntimeConnectionView state={{ kind: 'starting' }} output={output} />)
    expect(screen.queryByRole('log')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Diagnostic details' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    const log = diagnosticLog()
    expect(toggle.getAttribute('aria-controls')).toBe(log.parentElement?.id)
    expect(log.querySelectorAll('p')).toHaveLength(8)
    expect(log.textContent).toContain('Starting DSH connection')
    fireEvent.click(toggle)
    expect(screen.queryByRole('log')).toBeNull()
    rerender(<RuntimeConnectionView state={{ kind: 'connected' }} output={output} loadingSessionCatalog />)
    expect(screen.getByRole('heading', { name: 'Loading sessions' })).toBeDefined()
    expect(diagnosticLog().querySelectorAll('p')).toHaveLength(8)
  })

  it('distinguishes unavailable discovery candidates from actual errors', () => {
    render(
      <RuntimeConnectionView
        state={{ kind: 'starting' }}
        output={[
          {
            ...found,
            phase: 'verification',
            status: 'unavailable',
            attempt: 1,
            candidateSource: 'configured',
          },
          { ...found, id: 3, phase: 'verification', status: 'failed', attempt: 2, code: 'AUTH_REQUIRED' },
        ]}
      />,
    )
    const log = diagnosticLog()
    expect(log.querySelector('[data-status="unavailable"]')?.textContent).toContain(
      'Candidate unavailable; continuing discovery',
    )
    expect(log.querySelectorAll('[data-status="failed"]')).toHaveLength(1)
    expect(log.querySelector('[data-status="failed"]')?.textContent).toContain('AUTH_REQUIRED')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([
    ['discovering', 'Finding DSH'],
    ['locating-runtime', 'Looking for DSH'],
    ['starting', 'Starting DSH'],
    ['connecting', 'Connecting to DSH'],
    ['stopping', 'Disconnecting from DSH'],
  ] as const)('shows one heading and an indeterminate activity indicator for %s', (kind, title) => {
    render(<RuntimeConnectionView state={{ kind }} />)
    expect(screen.getByRole('heading', { name: title })).toBeDefined()
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
    expect(screen.queryByRole('log')).toBeNull()
    expect(diagnosticLog()).toBeDefined()
    expect(screen.queryByRole('list')).toBeNull()
    expect(
      document.querySelector(
        '.dsh-runtime-connection__hint,.dsh-runtime-connection__next,.dsh-runtime-connection__wait',
      ),
    ).toBeNull()
  })

  it.each([
    ['discovery', 'Finding a DSH instance'],
    ['authorization', 'Preparing DSH access'],
    ['verification', 'Verifying DSH connection'],
    ['initialization', 'Initializing DSH services'],
  ] as const)('reflects the active Host operation %s', (phase, title) => {
    render(<RuntimeConnectionView state={{ kind: 'connecting', phase }} output={[first, found]} />)
    expect(screen.getByRole('heading', { name: title })).toBeDefined()
  })

  it('renders actual results, versions, sources and failure codes in one output region', () => {
    render(
      <RuntimeConnectionView
        state={{ kind: 'connecting', phase: 'verification' }}
        output={[
          first,
          found,
          {
            id: 3,
            time: first.time,
            elapsedMs: 440,
            phase: 'verification',
            status: 'failed',
            attempt: 1,
            candidateSource: 'configured',
            code: 'PROTOCOL_ERROR',
          },
          {
            id: 4,
            time: first.time,
            elapsedMs: 510,
            phase: 'verification',
            status: 'succeeded',
            hostVersion: '0.2.1-rc.2',
            ownership: 'external',
          },
        ]}
      />,
    )
    const text = diagnosticLog().textContent
    expect(text).toContain('2 candidates')
    expect(text).toContain('candidate #1')
    expect(text).toContain('configured instance')
    expect(text).toContain('PROTOCOL_ERROR')
    expect(text).toContain('DSH 0.2.1-rc.2')
    expect(text).not.toMatch(/\+\d+(?:\.\d+)?s/u)
  })

  it('appends stable log rows and respects scrolling back through earlier output', () => {
    const { rerender } = render(<RuntimeConnectionView state={{ kind: 'connecting' }} output={[first]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostic details' }))
    const log = diagnosticLog()
    const row = log.firstElementChild
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
    })
    log.scrollTop = 200
    fireEvent.scroll(log)
    rerender(<RuntimeConnectionView state={{ kind: 'connecting' }} output={[first, found]} />)
    expect(log.firstElementChild).toBe(row)
    expect(log.scrollTop).toBe(200)
    log.scrollTop = 900
    fireEvent.scroll(log)
    rerender(
      <RuntimeConnectionView state={{ kind: 'connecting' }} output={[first, found, { ...found, id: 3 }]} />,
    )
    expect(log.scrollTop).toBe(1000)
  })

  it('opens full Output and Settings directly without polling diagnostics', () => {
    vi.useFakeTimers()
    const output = vi.fn().mockResolvedValue(undefined)
    const settings = vi.fn()
    render(
      <RuntimeConnectionView
        state={{ kind: 'starting' }}
        onShowDiagnosticsOutput={output}
        onOpenSettings={settings}
      />,
    )
    expect(vi.getTimerCount()).toBe(1) // One bounded phase timeout, no polling.
    diagnosticLog()
    fireEvent.click(screen.getByRole('button', { name: 'Open Output' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose connection source' }))
    expect(output).toHaveBeenCalledOnce()
    expect(settings).toHaveBeenCalledOnce()
  })

  it('preserves connection output on failure, exposes recovery and stops animation', () => {
    const retry = vi.fn()
    render(
      <RuntimeConnectionView
        state={{ kind: 'failed', message: 'DSH did not respond.', retryable: true }}
        output={[first, found]}
        onRetry={retry}
      />,
    )
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('DSH did not respond.')
    expect(diagnosticLog().textContent).toContain('2 candidates')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('distinguishes session catalog loading from readiness and reports an Output action failure', async () => {
    const { rerender } = render(
      <RuntimeConnectionView
        state={{ kind: 'connected' }}
        output={[found]}
        loadingSessionCatalog
        onShowDiagnosticsOutput={() => Promise.reject(new Error('private'))}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Loading sessions' })).toBeDefined()
    expect(diagnosticLog().textContent).toContain('2 candidates')
    diagnosticLog()
    fireEvent.click(screen.getByRole('button', { name: 'Open Output' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Unable to open Output.'))
    expect(document.body.textContent).not.toContain('private')
    rerender(<RuntimeConnectionView state={{ kind: 'connected' }} output={[found]} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('heading', { name: 'DSH is ready' })).toBeDefined()
  })
})

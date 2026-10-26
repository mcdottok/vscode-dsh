// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './AppHeader.js'

afterEach(cleanup)

describe('in-page DSH toolbar', () => {
  it('keeps frequent chat controls together without an overflow button', () => {
    const settings = vi.fn()
    const create = vi.fn()
    render(
      <AppHeader
        title="Current conversation"
        runtime={{ kind: 'connected' }}
        sessionControl={<button>Session history</button>}
        onNewSession={create}
        onOpenSettings={settings}
        onRetryConnection={vi.fn()}
      />,
    )
    const toolbar = screen.getByRole('toolbar', { name: 'DSH toolbar' })
    expect(within(toolbar).getByText('Current conversation')).toBeDefined()
    expect(within(toolbar).getByRole('button', { name: 'Session history' })).toBeDefined()
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Settings' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'New Session' }))
    expect(settings).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
    expect(within(toolbar).queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('keeps settings available before a runtime connects and hides chat-only controls', () => {
    const settings = vi.fn()
    render(
      <AppHeader
        runtime={{ kind: 'failed', retryable: true, message: 'Offline' }}
        sessionControl={<button>Session history</button>}
        onNewSession={vi.fn()}
        onOpenSettings={settings}
        onRetryConnection={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(settings).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'New Session' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Session history' })).toBeNull()
  })
})

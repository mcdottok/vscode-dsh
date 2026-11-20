// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RuntimeMissingView } from './RuntimeMissingView.js'

describe('RuntimeMissingView', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-dsh-remote')
  })

  it('explains the setup path and exposes install, selection, command, retry, and docs actions', () => {
    const onOpenSettings = vi.fn()
    const onOpenConnectionSettings = vi.fn()
    const onAction = vi.fn()
    render(
      <RuntimeMissingView
        searchedLocations={['/usr/bin/dsh', '/usr/bin/dsh']}
        busyAction={undefined}
        onAction={onAction}
        onRetry={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenConnectionSettings={onOpenConnectionSettings}
      />,
    )

    expect(screen.getByRole('heading', { name: 'DSH CLI was not found' })).toBeDefined()
    expect(screen.getByText(/workspace environment or in global install locations/)).toBeDefined()
    expect(screen.getByText(/Press Enter in the terminal to install/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Install DSH CLI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try connecting to DSH Desktop' }))
    expect(onAction.mock.calls).toEqual([['install']])
    expect(onOpenConnectionSettings).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Select an existing CLI' })).toBeDefined()
    fireEvent.click(screen.getByText('More options'))
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Recheck CLI' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Docs' })).toBeDefined()
    expect(screen.getByText('Searched locations (1)')).toBeDefined()
  })

  it.each(['ssh-remote', 'wsl'] as const)(
    'keeps settings accessible without the Desktop shortcut in %s',
    (remote) => {
      document.documentElement.setAttribute('data-dsh-remote', remote)
      const openSettings = vi.fn()
      render(
        <RuntimeMissingView
          searchedLocations={[]}
          busyAction={undefined}
          onAction={vi.fn()}
          onOpenConnectionSettings={vi.fn()}
          onOpenSettings={openSettings}
        />,
      )

      expect(screen.queryByRole('button', { name: 'Try connecting to DSH Desktop' })).toBeNull()
      fireEvent.click(screen.getByText('More options'))
      fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
      expect(openSettings).toHaveBeenCalledOnce()
    },
  )
})

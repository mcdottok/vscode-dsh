// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AppStore } from '../../app/store.js'
import { WorkspaceBrowserGroups } from './WorkspaceBrowserGroups.js'

afterEach(cleanup)

it('previews history with the normal chat cards and keeps reading separate from opening the project', async () => {
  const request = vi.fn<AppStore['workspaceBrowser']>((action, _workspaceId, _sessionId, before) => {
    if (action === 'list')
      return Promise.resolve({ items: [{ id: 'other', name: 'Other project', count: 1, canOpen: true }] })
    if (action === 'sessions')
      return Promise.resolve({ items: [{ id: 'conversation', title: 'Review changes', archived: false }] })
    if (action === 'preview')
      return Promise.resolve(
        before === undefined
          ? {
              items: [
                { id: 'user-1', role: 'user', text: 'Please review the changes.' },
                { id: 'assistant-1', role: 'assistant', text: 'The **changes** look good.' },
                { id: 'tool-1', role: 'tool', text: 'Internal tool record' },
              ],
              hasMore: true,
              beforeSequence: 20,
            }
          : { items: [{ id: 'older-1', role: 'user', text: 'Earlier request.' }], hasMore: false },
      )
    return Promise.resolve({})
  })
  render(
    <WorkspaceBrowserGroups
      open
      request={request}
      workspaces={[]}
      query=""
      archiveFilter="all"
      renderHeader={() => null}
      renderCurrent={() => null}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Other project/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Review changes/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Review changes' })
  await within(dialog).findByText('Please review the changes.')

  const user = within(dialog).getByRole('article', { name: 'Your message' })
  const assistant = within(dialog).getByRole('article', { name: 'Assistant' })
  expect(user.classList.contains('dsh-timeline__card--user')).toBe(true)
  expect(user.closest('.dsh-timeline__message-stack--user')).not.toBeNull()
  expect(assistant.classList.contains('dsh-timeline__card--assistant')).toBe(true)
  expect(assistant.querySelector('strong')?.textContent).toBe('changes')
  expect(within(dialog).queryByText('User')).toBeNull()
  expect(within(dialog).queryByText('Assistant')).toBeNull()
  expect(within(dialog).queryByText('Internal tool record')).toBeNull()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Load earlier messages' }))
  await within(dialog).findByText('Earlier request.')
  expect(request).toHaveBeenCalledWith('preview', 'other', 'conversation', 20)
  expect(within(dialog).getAllByRole('article', { name: 'Your message' })).toHaveLength(2)
  expect(request.mock.calls.some(([action]) => action === 'open')).toBe(false)

  fireEvent.click(within(dialog).getByRole('button', { name: 'Open project in a new window and continue' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review changes' })).toBeNull())
  expect(request).toHaveBeenCalledWith('open', 'other', 'conversation')
})

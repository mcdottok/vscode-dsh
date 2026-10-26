// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import type { AgentPresetDescriptor, WorkspaceSummary } from '@dsh-vscode/domain'
import { EmptySessionPosture } from './EmptySessionPosture.js'

afterEach(cleanup)
type PostureState = {
  readonly activeSessionId: string | undefined
  readonly workspaces: readonly WorkspaceSummary[]
  readonly presets: readonly AgentPresetDescriptor[]
  readonly presetSelectionEnabled?: boolean
}
function connectedState(active: boolean): PostureState {
  return {
    activeSessionId: active ? 's1' : undefined,
    presets: [],
    workspaces: [
      {
        id: 'w1',
        name: 'Workspace',
        sessionCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}
function presetSelectionState(enabled: boolean, defaultId: string | undefined): PostureState {
  return {
    ...connectedState(false),
    presetSelectionEnabled: enabled,
    presets: ['standard', 'alternate', 'updated-default'].map((id) => ({
      id,
      trust: 'system',
      isDefault: id === defaultId,
      name: id,
    })),
  }
}
function renderWithMutableState(initialState: PostureState): {
  readonly stageSessionCalls: Array<[string | undefined, string | undefined]>
  readonly updateState: (state: PostureState) => void
} {
  const stageSessionCalls: Array<[string | undefined, string | undefined]> = []
  const element = (state: PostureState): ReactElement | null =>
    state.activeSessionId === undefined ? (
      <EmptySessionPosture
        workspaces={state.workspaces}
        presets={state.presets}
        empty
        {...(state.presetSelectionEnabled === undefined
          ? {}
          : { presetSelectionEnabled: state.presetSelectionEnabled })}
        onCreate={(workspace, preset) => stageSessionCalls.push([workspace, preset])}
      />
    ) : null
  const view = render(element(initialState))
  return { stageSessionCalls, updateState: (state: PostureState) => view.rerender(element(state)) }
}
async function selectEmptySessionPreset(presetId: string): Promise<void> {
  await waitFor(() =>
    expect(document.querySelector('.dsh-empty-session__preset .dsh-select-menu__trigger')).not.toBeNull(),
  )
  const trigger = document.querySelector('.dsh-empty-session__preset .dsh-select-menu__trigger')
  if (trigger === null) throw new Error('preset selection did not appear after DSH settings loaded')
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: presetId }))
}

describe('standalone EmptySessionPosture', () => {
  it('lets the Host resolve the default after preset selection is disabled', async () => {
    const initialState = presetSelectionState(true, 'standard')
    const { stageSessionCalls, updateState } = renderWithMutableState(initialState)
    await selectEmptySessionPreset('alternate')

    updateState(presetSelectionState(false, 'standard'))
    fireEvent.click(screen.getByRole('button', { name: 'New session here' }))

    expect(stageSessionCalls).toEqual([['w1', undefined]])
  })
  it('tracks the Host default while the new-session page is open', async () => {
    const initialState = presetSelectionState(true, 'standard')
    const { stageSessionCalls, updateState } = renderWithMutableState(initialState)
    updateState(presetSelectionState(true, 'updated-default'))
    await waitFor(() =>
      expect(document.querySelector('.dsh-empty-session__preset .dsh-select-menu__trigger')).not.toBeNull(),
    )
    const presetPicker = document.querySelector('.dsh-empty-session__preset .dsh-select-menu__trigger')
    expect(presetPicker?.textContent ?? '').toContain('updated-default')
    fireEvent.click(screen.getByRole('button', { name: 'New session here' }))

    expect(stageSessionCalls).toEqual([['w1', undefined]])
  })
  it('uses a manual preset for one new task, then returns to the latest Host default', async () => {
    const { stageSessionCalls, updateState } = renderWithMutableState(presetSelectionState(true, 'standard'))
    await selectEmptySessionPreset('alternate')
    fireEvent.click(screen.getByRole('button', { name: 'New session here' }))

    updateState(connectedState(true))
    updateState(presetSelectionState(true, 'updated-default'))
    await waitFor(() =>
      expect(document.querySelector('.dsh-empty-session__preset .dsh-select-menu__trigger')).not.toBeNull(),
    )
    const presetPicker = document.querySelector('.dsh-empty-session__preset .dsh-select-menu__trigger')
    expect(presetPicker?.textContent ?? '').toContain('updated-default')
    fireEvent.click(screen.getByRole('button', { name: 'New session here' }))

    expect(stageSessionCalls).toEqual([
      ['w1', 'alternate'],
      ['w1', undefined],
    ])
  })
  it('creates through Host composition when the optional preset registry is empty', () => {
    const state = { ...connectedState(false), presetSelectionEnabled: false, presets: [] }
    const { stageSessionCalls } = renderWithMutableState(state)
    const createButton = screen.getByRole('button', { name: 'New session here' })

    expect((createButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(createButton)

    expect(stageSessionCalls).toEqual([['w1', undefined]])
  })
  it('blocks session creation when preset selection is disabled and the roster has no default', () => {
    const { stageSessionCalls } = renderWithMutableState(presetSelectionState(false, undefined))
    const createButton = screen.getByRole('button', { name: 'New session here' })

    expect((createButton as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getByText(/DSH did not provide a default preset, and preset selection is unavailable/),
    ).toBeDefined()
    fireEvent.click(createButton)

    expect(stageSessionCalls).toEqual([])
  })
})

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState, type ReactElement } from 'react'
import { I18nProvider, useI18n } from '../../i18n.js'
import type { EditableModel } from './ModelListEditor.js'
import { ModelReasoningEfforts, validateReasoningEfforts } from './ModelReasoningEfforts.js'

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function Harness(props: {
  readonly initial: EditableModel
  readonly levels?: readonly string[]
  readonly levelsOnly?: boolean
  readonly onChange?: (model: EditableModel) => void
}): ReactElement {
  const [model, setModel] = useState<EditableModel>(props.initial)
  return (
    <I18nProvider>
      <Editor
        model={model}
        levels={props.levels ?? LEVELS}
        levelsOnly={props.levelsOnly === true}
        onChange={(next) => {
          setModel(next)
          props.onChange?.(next)
        }}
      />
    </I18nProvider>
  )
}

function Editor(props: {
  readonly model: EditableModel
  readonly levels: readonly string[]
  readonly levelsOnly: boolean
  readonly onChange: (model: EditableModel) => void
}): ReactElement {
  const { t } = useI18n()
  return (
    <ModelReasoningEfforts
      model={props.model}
      levels={props.levels}
      levelsOnly={props.levelsOnly}
      position={1}
      disabled={false}
      t={t}
      onChange={props.onChange}
    />
  )
}

describe('ModelReasoningEfforts', () => {
  afterEach(() => cleanup())

  it('shows the API parameter help on focus and dismisses it with Escape', () => {
    render(<Harness initial={{ id: 'model' }} onChange={() => undefined} />)
    const help = screen.getByRole('button', { name: 'About reasoning levels' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(help)
    expect(screen.getByRole('tooltip').textContent).toContain('reasoning_effort')
    fireEvent.keyDown(help, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('starts a declaration from the schema levels and removes it when the switch is off', () => {
    const changes: EditableModel[] = []
    render(<Harness initial={{ id: 'model' }} onChange={(next) => changes.push(next)} />)

    const toggle = screen.getByRole<HTMLInputElement>('switch', { name: 'Reasoning effort 1' })
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)

    expect(changes.at(-1)).toEqual({
      id: 'model',
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    })

    fireEvent.click(toggle)
    expect(changes.at(-1)).toEqual({ id: 'model' })
  })

  it('edits a wire spelling and repairs an empty value on blur', () => {
    const changes: EditableModel[] = []
    render(
      <Harness
        initial={{ id: 'model', reasoningEfforts: { off: null, low: 'low', high: 'high' } }}
        onChange={(next) => changes.push(next)}
      />,
    )

    const low = screen.getByLabelText<HTMLInputElement>('low API parameter value')
    fireEvent.change(low, { target: { value: 'minimal' } })
    expect(changes.at(-1)?.reasoningEfforts).toEqual({ off: null, low: 'minimal', high: 'high' })

    fireEvent.change(low, { target: { value: '   ' } })
    fireEvent.blur(low)
    expect(changes.at(-1)?.reasoningEfforts).toEqual({ off: null, low: 'low', high: 'high' })
  })

  it('keeps the off value unsent and removes or adds levels', () => {
    const changes: EditableModel[] = []
    render(
      <Harness
        initial={{ id: 'model', reasoningEfforts: { off: null, low: 'low', high: 'high' } }}
        onChange={(next) => changes.push(next)}
      />,
    )

    expect(screen.getByLabelText<HTMLInputElement>('off API parameter value').disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Remove reasoning level low' }))
    expect(changes.at(-1)?.reasoningEfforts).toEqual({ off: null, high: 'high' })

    fireEvent.click(screen.getByRole('button', { name: 'Add level' }))
    expect(changes.at(-1)?.reasoningEfforts).toEqual({ off: null, high: 'high', xhigh: 'xhigh' })
  })

  it('reports the adapter refusals the write would hit', () => {
    expect(
      validateReasoningEfforts([{ id: 'model', reasoningEfforts: { off: null } }], LEVELS, false),
    ).toEqual({ index: 0, key: 'modelReasoningNeedsLevel' })
    expect(
      validateReasoningEfforts([{ id: 'model', reasoningEfforts: { low: 'low', high: '' } }], LEVELS, false),
    ).toEqual({ index: 0, key: 'modelReasoningValueRequired' })
    expect(
      validateReasoningEfforts(
        [{ id: 'model', reasoningEfforts: { low: 'low', medium: 'medium' } }],
        LEVELS,
        false,
      ),
    ).toBeUndefined()
  })

  it('offers levels-only protocols only their fixed spellings', () => {
    render(
      <Harness
        initial={{ id: 'model', reasoningEfforts: { minimal: 'minimal', high: 'high' } }}
        levels={['minimal', 'low', 'medium', 'high']}
        levelsOnly
      />,
    )

    expect(screen.getByLabelText<HTMLInputElement>('minimal API parameter value').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Level 1: minimal' }))
    expect(screen.getByRole('option', { name: 'low' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'medium' })).toBeDefined()
    expect(screen.queryByRole('option', { name: 'high' })).toBeNull()
  })

  it('refuses levels and spellings a levels-only protocol would not send', () => {
    expect(
      validateReasoningEfforts(
        [{ id: 'model', reasoningEfforts: { minimal: 'minimal', high: 'ultra' } }],
        ['minimal', 'low', 'medium', 'high'],
        true,
      ),
    ).toEqual({ index: 0, key: 'modelReasoningLevelsOnly' })
    expect(
      validateReasoningEfforts(
        [{ id: 'model', reasoningEfforts: { minimal: 'minimal', low: 'low' } }],
        ['minimal', 'low', 'medium', 'high'],
        true,
      ),
    ).toBeUndefined()
  })
})

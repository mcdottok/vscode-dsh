// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorContextActions } from './EditorContextActions.js'

describe('EditorContextActions', () => {
  afterEach(() => cleanup())

  it('keeps explicit selection capture and removes the redundant symbol shortcut', async () => {
    const onCapture = vi.fn()
    render(
      <EditorContextActions
        disabled={false}
        availableKinds={['selection', 'symbol']}
        onCapture={onCapture}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Add current symbol to DSH context' })).toBeNull()
    const action = screen.getByRole('button', { name: 'Add selected text to DSH context' })
    expect(action).toBeDefined()
    fireEvent.click(action)

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith('selection'))
  })

  it('does not infer symbol support when the Host reports another context kind', () => {
    render(<EditorContextActions disabled={false} availableKinds={['file']} onCapture={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Add current symbol to DSH context' })).toBeNull()
  })
})

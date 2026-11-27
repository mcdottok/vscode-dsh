// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Drawer } from './Drawer.js'

describe('Drawer', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not mount a closed drawer and closes from Escape while open', () => {
    const onClose = vi.fn()
    const view = render(<Drawer title="Settings" open={false} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    view.rerender(<Drawer title="Settings" open onClose={onClose} />)
    expect(screen.getByRole('dialog').parentElement?.getAttribute('data-state')).toBe('open')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    view.rerender(<Drawer title="Settings" open={false} onClose={onClose} />)
    expect(screen.getByRole('dialog', { hidden: true }).parentElement?.getAttribute('data-state')).toBe(
      'closing',
    )
  })

  it('keeps the surface mounted while an exit animation is finishing', () => {
    const onClose = vi.fn()
    const view = render(
      <Drawer title="Settings" open onClose={onClose}>
        <button type="button">Focusable content</button>
      </Drawer>,
    )

    const dialog = screen.getByRole('dialog')
    const backdrop = dialog.parentElement
    expect(backdrop?.getAttribute('data-state')).toBe('open')

    view.rerender(
      <Drawer title="Settings" open={false} onClose={onClose}>
        <button type="button">Focusable content</button>
      </Drawer>,
    )

    expect(dialog.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.hasAttribute('inert')).toBe(true)
    expect(dialog.parentElement?.getAttribute('data-state')).toBe('closing')
    fireEvent.animationEnd(dialog)
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
  })

  it('uses the unload fallback when the browser omits animationend', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const view = render(<Drawer title="Settings" open onClose={onClose} />)

    view.rerender(<Drawer title="Settings" open={false} onClose={onClose} />)
    expect(screen.getByRole('dialog', { hidden: true })).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(361)
    })
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
  })

  it('uses the actual exit instead of cutting off a longer motion setting', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const view = render(<Drawer title="Settings" open onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    let finish: () => void = () => undefined
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    Object.defineProperty(dialog, 'getAnimations', { value: () => [{ finished }] })

    view.rerender(<Drawer title="Settings" open={false} onClose={onClose} />)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(dialog.isConnected).toBe(true)
    await act(async () => finish())
    expect(dialog.isConnected).toBe(false)
  })

  it('restores focus when closing starts and ignores backdrop input during exit', () => {
    const onClose = vi.fn()
    const view = render(
      <>
        <button type="button">Open settings</button>
        <Drawer title="Settings" open onClose={onClose} />
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Open settings' })
    trigger.focus()

    const dialog = screen.getByRole('dialog')
    view.rerender(
      <>
        <button type="button">Open settings</button>
        <Drawer title="Settings" open={false} onClose={onClose} />
      </>,
    )
    const closingBackdrop = screen.getByRole('presentation')
    fireEvent.mouseDown(closingBackdrop)

    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
    expect(dialog.getAttribute('aria-hidden')).toBe('true')
  })
})

// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { useOverflowRail } from './useOverflowRail.js'

afterEach(() => cleanup())

function Rail({ count }: { readonly count: number }): ReactElement {
  const { railRef, scrollable } = useOverflowRail<HTMLDivElement>(count)
  return (
    <div ref={railRef} data-testid="rail" data-scrollable={scrollable ? 'true' : 'false'}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index}>chip</span>
      ))}
    </div>
  )
}

/** jsdom never lays out: give the rail the geometry the browser would report. */
function measure(element: HTMLElement, clientWidth: number, scrollWidth: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth })
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth })
}

describe('Overflow rail measurement', () => {
  it('reports overflow only after the geometry is re-read', () => {
    const { rerender } = render(<Rail count={1} />)
    const rail = screen.getByTestId('rail')
    expect(rail.dataset.scrollable).toBe('false')

    measure(rail, 240, 480)
    rerender(<Rail count={2} />)
    expect(rail.dataset.scrollable).toBe('true')
  })

  it('settles back once a resize makes the row fit again', () => {
    const { rerender } = render(<Rail count={3} />)
    const rail = screen.getByTestId('rail')
    measure(rail, 240, 480)
    rerender(<Rail count={4} />)
    expect(rail.dataset.scrollable).toBe('true')

    measure(rail, 480, 480)
    act(() => {
      rail.dispatchEvent(new Event('scroll'))
    })
    expect(rail.dataset.scrollable).toBe('false')
  })
})

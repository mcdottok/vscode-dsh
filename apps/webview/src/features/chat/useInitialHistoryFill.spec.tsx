// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import type { TimelineNode } from '@dsh-vscode/timeline'
import { useInitialHistoryFill } from './useInitialHistoryFill.js'

const user = (id: string): TimelineNode => ({ kind: 'user-message', id, markdown: id })
const reply = (id: string): TimelineNode => ({
  kind: 'assistant-message',
  id,
  markdown: id,
  streaming: false,
})
let height = 800
let contentHeight = 800
let resized: () => void
function Harness(props: {
  nodes: readonly TimelineNode[]
  load: () => Promise<void>
  before?: number
  sessionId?: string
  hasMore?: boolean
  loading?: boolean
  reveal?: boolean
}): React.ReactElement {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useInitialHistoryFill({
    sessionId: props.sessionId ?? 'session',
    nodes: props.nodes,
    load: props.load,
    beforeSequence: props.before,
    hasMore: props.hasMore ?? true,
    loading: props.loading ?? false,
    reveal: props.reveal ?? false,
    viewport,
    content,
  })
  return (
    <div
      ref={(element) => {
        viewport.current = element
        if (element !== null) {
          Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => height })
          Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => contentHeight })
        }
      }}
      data-testid="viewport"
    >
      <div ref={content} />
    </div>
  )
}
async function frame(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function setup(): void {
  vi.useFakeTimers()
  height = 800
  contentHeight = 800
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback
      }
      observe(): void {}
      disconnect(): void {}
    },
  )
}
describe('initial history fill', () => {
  it('loads a second user turn even when the current turn fills the viewport, then stops', async () => {
    setup()
    contentHeight = 1400
    const load = vi.fn(() => Promise.resolve())
    const view = render(<Harness nodes={[user('latest'), reply('answer')]} load={load} before={10} />)
    await frame()
    expect(load).toHaveBeenCalledOnce()
    view.rerender(
      <Harness
        nodes={[user('old'), reply('old-answer'), user('latest'), reply('answer')]}
        load={load}
        before={5}
      />,
    )
    await frame()
    expect(load).toHaveBeenCalledOnce()
  })

  it('keeps filling short conversations after two turns until measured content fills the viewport', async () => {
    setup()
    const load = vi.fn(() => Promise.resolve())
    const nodes = [user('old'), reply('old-answer'), user('latest'), reply('answer')]
    const view = render(<Harness nodes={nodes} load={load} before={10} />)
    await frame()
    expect(load).toHaveBeenCalledOnce()
    view.rerender(<Harness nodes={[user('older'), reply('older-answer'), ...nodes]} load={load} before={5} />)
    await frame()
    expect(load).toHaveBeenCalledTimes(2)
    contentHeight = 1100
    view.rerender(
      <Harness
        nodes={[user('oldest'), user('older'), reply('older-answer'), ...nodes]}
        load={load}
        before={0}
      />,
    )
    await frame()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('waits for a measured viewport and observes later size changes', async () => {
    setup()
    height = 0
    const load = vi.fn(() => Promise.resolve())
    render(<Harness nodes={[user('latest')]} load={load} />)
    await frame()
    expect(load).not.toHaveBeenCalled()
    height = 800
    resized()
    await frame()
    expect(load).toHaveBeenCalledOnce()
  })

  it('waits while hidden and starts when the view becomes visible', async () => {
    setup()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const load = vi.fn(() => Promise.resolve())
    try {
      render(<Harness nodes={[user('latest')]} load={load} />)
      await frame()
      expect(load).not.toHaveBeenCalled()
      visibility.mockReturnValue('visible')
      fireEvent(document, new Event('visibilitychange'))
      await frame()
      expect(load).toHaveBeenCalledOnce()
    } finally {
      visibility.mockRestore()
    }
  })

  it.each(['wheel', 'pointerdown', 'keydown', 'touchstart'])(
    'lets a reader gesture stop automatic loading: %s',
    async (event) => {
      setup()
      const load = vi.fn(() => Promise.resolve())
      render(<Harness nodes={[user('latest')]} load={load} />)
      fireEvent(screen.getByTestId('viewport'), new Event(event))
      await frame()
      expect(load).not.toHaveBeenCalled()
    },
  )

  it('serializes reads and allows a cursor-only page to advance without replacing nodes', async () => {
    setup()
    let finish!: () => void
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const nodes = [user('latest')]
    const view = render(<Harness nodes={nodes} load={load} before={10} />)
    await frame()
    resized()
    await frame()
    expect(load).toHaveBeenCalledOnce()
    view.rerender(<Harness nodes={nodes} load={load} before={5} />)
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    await frame()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('stops after an empty non-advancing read or failure instead of spinning', async () => {
    setup()
    const load = vi.fn(() => Promise.resolve())
    const view = render(<Harness nodes={[user('latest')]} load={load} />)
    await frame()
    await frame()
    resized()
    await frame()
    expect(load).toHaveBeenCalledOnce()
    const fail = vi.fn(() => Promise.reject(new Error('not available')))
    view.rerender(<Harness sessionId="other" nodes={[user('other')]} load={fail} />)
    await frame()
    await frame()
    expect(fail).toHaveBeenCalledOnce()
  })

  it('does not resume an old session after a pending read settles', async () => {
    setup()
    let finish!: () => void
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const view = render(<Harness nodes={[user('latest')]} load={load} />)
    await frame()
    const other = vi.fn(() => Promise.resolve())
    view.rerender(<Harness sessionId="other" nodes={[user('other')]} load={other} hasMore={false} />)
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    await frame()
    expect(other).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledOnce()
  })

  it('caps automatic reads while leaving manual history available', async () => {
    setup()
    const load = vi.fn(() => Promise.resolve())
    const nodes = [user('latest')]
    const view = render(<Harness nodes={nodes} load={load} before={100} />)
    for (let page = 0; page < 20; page++) {
      view.rerender(<Harness nodes={nodes} load={load} before={100 - page} />)
      await frame()
    }
    expect(load).toHaveBeenCalledTimes(12)
  })

  it.each([{ hasMore: false }, { loading: true }, { reveal: true }])(
    'respects history availability, active loads and explicit reveal: %j',
    async (flags) => {
      setup()
      const load = vi.fn(() => Promise.resolve())
      render(<Harness nodes={[user('latest')]} load={load} {...flags} />)
      await frame()
      expect(load).not.toHaveBeenCalled()
    },
  )
})

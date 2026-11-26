// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCallback, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScrollFollow } from './useScrollFollow.js'
import { useVirtualizedCollection } from './useVirtualizedCollection.js'

describe('useScrollFollow user jump', () => {
  it('does not schedule extra React renders for unchanged jump visibility during streaming', async () => {
    let renders = 0
    function Stream({ revision }: { revision: number }): ReactElement {
      renders++
      const follow = useScrollFollow({ contentKey: revision, itemCount: 1, sessionId: 'live' })
      return (
        <div ref={follow.scrollRef}>
          <div ref={follow.contentRef} />
        </div>
      )
    }
    const view = render(<Stream revision={0} />)
    await act(async () => {
      await Promise.resolve()
    })
    const before = renders
    for (let revision = 1; revision <= 20; revision++) {
      view.rerender(<Stream revision={revision} />)
      await act(async () => {
        await Promise.resolve()
      })
    }
    expect(renders - before).toBe(20)
  })

  it('follows appended content before any fixed timer is advanced', async () => {
    vi.useFakeTimers()
    function Stream({ revision }: { revision: number }): ReactElement {
      const follow = useScrollFollow({
        contentKey: revision,
        itemCount: 1,
        sessionId: 'live',
        observeContentSize: false,
      })
      return (
        <div ref={follow.scrollRef} data-testid="live-viewport" onScroll={follow.handleScroll}>
          <div ref={follow.contentRef} />
        </div>
      )
    }
    const view = render(<Stream revision={0} />)
    const viewport = screen.getByTestId<HTMLDivElement>('live-viewport')
    setScrollMetrics(viewport, 600, 1_000, 400)
    await act(async () => {
      await Promise.resolve()
    })
    setScrollMetrics(viewport, 600, 1_200, 400)
    view.rerender(<Stream revision={1} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(viewport.scrollTop).toBe(800)
  })

  it('applies row measurements to the restored position before the next scroll event', () => {
    const items = ['first', 'retained']
    let measuredHeight = 96
    let anchorStart = 20
    function Conversation(): ReactElement {
      const follow = useScrollFollow({ contentKey: 'history', itemCount: items.length })
      const { measureElement, remeasureItem } = useVirtualizedCollection({
        items,
        enabled: true,
        scrollRef: follow.scrollRef,
        onScrollAdjustment: follow.applyScrollAdjustment,
      })
      const measureFirst = useCallback(
        (row: HTMLDivElement | null): void => {
          if (row !== null)
            Object.defineProperty(row, 'offsetHeight', { configurable: true, get: () => measuredHeight })
          measureElement(row)
        },
        [measureElement],
      )
      return (
        <>
          <div ref={follow.scrollRef} data-testid="viewport">
            <div ref={measureFirst} data-index={0} />
            <div data-node-id="retained" data-testid="retained" />
          </div>
          <button
            type="button"
            onClick={() => {
              const anchor = follow.captureScrollAnchor()
              if (anchor === undefined) throw new Error('Missing scroll anchor')
              anchorStart = 520
              follow.restoreScrollAnchor(anchor)
              measuredHeight = 120
              remeasureItem(0)
              measuredHeight = 128
              remeasureItem(0)
            }}
          >
            Prepend history
          </button>
        </>
      )
    }

    render(<Conversation />)
    const viewport = screen.getByTestId<HTMLDivElement>('viewport')
    setScrollMetrics(viewport, 20, 4_800, 300)
    vi.spyOn(screen.getByTestId('retained'), 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, anchorStart - viewport.scrollTop, 240, 96),
    )
    fireEvent.wheel(viewport, { deltaY: -24 })
    fireEvent.scroll(viewport)
    fireEvent.click(screen.getByRole('button', { name: 'Prepend history' }))
    expect(viewport.scrollTop).toBe(552)
  })

  it('eases to the growing tail through reply completion and yields to an upward wheel', async () => {
    stubReducedMotion(false)
    const resize = stubViewportResize()
    let nextFrame: FrameRequestCallback | undefined
    const advanceFrame = (timestamp: number): void => {
      const callback = nextFrame
      nextFrame = undefined
      act(() => callback?.(timestamp))
    }
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      nextFrame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', (): void => {
      nextFrame = undefined
    })
    function Stream({ revision }: { revision: number }): ReactElement {
      const follow = useScrollFollow({
        contentKey: revision,
        itemCount: 1,
        smoothTailGrowth: true,
      })
      return (
        <div ref={follow.scrollRef} data-testid="stream-viewport" onScroll={follow.handleScroll}>
          <div ref={follow.contentRef} data-testid="stream-content" />
        </div>
      )
    }
    const view = render(<Stream revision={0} />)
    const viewport = screen.getByTestId<HTMLDivElement>('stream-viewport')
    const content = screen.getByTestId('stream-content')
    setScrollMetrics(viewport, 600, 1000, 400)
    act(() => resize(content, 1000))
    await act(async () => Promise.resolve())

    setScrollMetrics(viewport, 600, 1036, 400)
    view.rerender(<Stream revision={1} />)
    await act(async () => Promise.resolve())
    expect(viewport.scrollTop).toBe(600)
    const now = performance.now()
    advanceFrame(now + 16)
    expect(viewport.scrollTop).toBeGreaterThan(600)
    expect(viewport.scrollTop).toBeLessThan(606)
    const firstPosition = viewport.scrollTop

    setScrollMetrics(viewport, firstPosition, 1060, 400)
    view.rerender(<Stream revision={2} />)
    await act(async () => Promise.resolve())
    fireEvent.scroll(viewport)
    expect(viewport.scrollTop).toBe(firstPosition)
    advanceFrame(now + 32)
    expect(viewport.scrollTop - firstPosition).toBeGreaterThan(firstPosition - 600)
    const beforeCompletion = viewport.scrollTop
    view.rerender(<Stream revision={3} />)
    expect(viewport.scrollTop).toBe(beforeCompletion)

    // The footer expands after the terminal commit, while the last line is
    // still scrolling into place. Retarget the same motion.
    setScrollMetrics(viewport, beforeCompletion, 1096, 400)
    act(() => resize(content, 1096))
    expect(viewport.scrollTop).toBe(beforeCompletion)
    for (let frame = 3; frame <= 24 && nextFrame !== undefined; frame++) {
      const before = viewport.scrollTop
      advanceFrame(now + frame * 16)
      expect(viewport.scrollTop).toBeGreaterThanOrEqual(before)
      expect(viewport.scrollTop).toBeLessThanOrEqual(696)
    }
    expect(viewport.scrollTop).toBe(696)
    expect(nextFrame).toBeUndefined()

    // A native event for the last animated write can arrive after the next
    // line grows the tail. It should start another eased follow.
    setScrollMetrics(viewport, 696, 1120, 400)
    fireEvent.scroll(viewport)
    expect(viewport.scrollTop).toBe(696)
    expect(nextFrame).toBeDefined()

    fireEvent.wheel(viewport, { deltaY: -40 })
    expect(nextFrame).toBeUndefined()
  })

  it('keeps a pinned reader glued to the tail when the viewport narrows', async () => {
    stubReducedMotion(false)
    const resize = stubViewportResize()
    function Stream(): ReactElement {
      const follow = useScrollFollow({
        contentKey: 'narrow',
        itemCount: 1,
        smoothTailGrowth: true,
      })
      return (
        <div ref={follow.scrollRef} data-testid="narrow-viewport" onScroll={follow.handleScroll}>
          <div ref={follow.contentRef} data-testid="narrow-content" />
          <output data-testid="narrow-pinned" data-pinned={String(follow.isPinnedToBottom)} />
        </div>
      )
    }
    render(<Stream />)
    const viewport = screen.getByTestId<HTMLDivElement>('narrow-viewport')
    const content = screen.getByTestId('narrow-content')
    setScrollMetrics(viewport, 600, 1_000, 400)
    act(() => {
      resize(viewport, 400, 240)
      resize(content, 1_000)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(viewport.scrollTop).toBe(600)

    // Narrowing the panel reflows the conversation taller while the reader is
    // still pinned. The tail has to land under the viewport before paint
    // instead of easing down through the gap the reflow opened.
    setScrollMetrics(viewport, 600, 1_340, 400)
    act(() => {
      resize(viewport, 400, 200)
      resize(content, 1_340)
    })
    expect(viewport.scrollTop).toBe(940)
    expect(screen.getByTestId('narrow-pinned').getAttribute('data-pinned')).toBe('true')
  })

  it('lets a captured reader gesture cancel same-turn append following', async () => {
    vi.useFakeTimers()
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 600, 1_200, 400)
    fireEvent.wheel(viewport, { deltaY: -80 })
    setScrollMetrics(viewport, 520, 1_200, 400)
    fireEvent.scroll(viewport)
    await act(async () => {
      await Promise.resolve()
    })
    expect(viewport.scrollTop).toBe(520)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
    act(() => {
      vi.runAllTimers()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(viewport.scrollTop).toBe(520)
  })

  it('keeps the reading position when middle-button autoscroll starts during session placement', async () => {
    vi.useFakeTimers()
    function Conversation({ sessionId, revision }: { sessionId: string; revision: number }): ReactElement {
      const follow = useScrollFollow({
        sessionId,
        contentKey: revision,
        itemCount: 30,
        layoutMeasurementsActive: true,
        smoothTailGrowth: true,
      })
      return (
        <div ref={follow.scrollRef} data-testid="viewport" data-pinned={follow.isPinnedToBottom}>
          <div ref={follow.contentRef} />
        </div>
      )
    }

    const view = render(<Conversation sessionId="first" revision={0} />)
    const viewport = screen.getByTestId<HTMLDivElement>('viewport')
    setScrollMetrics(viewport, 600, 1_000, 400)
    view.rerender(<Conversation sessionId="second" revision={0} />)

    expect(fireEvent.pointerDown(viewport, { button: 1, pointerType: 'mouse', cancelable: true })).toBe(true)
    viewport.scrollTop = 250
    fireEvent.scroll(viewport)
    expect(viewport.scrollTop).toBe(250)
    expect(viewport.getAttribute('data-pinned')).toBe('false')

    fireEvent.pointerDown(viewport, { button: 1, pointerType: 'mouse' })
    fireEvent(viewport, new Event('scrollend'))
    setScrollMetrics(viewport, 250, 1_150, 400)
    view.rerender(<Conversation sessionId="second" revision={1} />)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(viewport.scrollTop).toBe(250)
    expect(viewport.getAttribute('data-pinned')).toBe('false')
  })

  it.each([
    { top: 100, deltaY: -80, pinned: true },
    { top: 0, deltaY: 80, pinned: true },
    { top: 0, deltaY: -80, pinned: false },
    { top: 300, deltaY: 80, pinned: false },
  ])(
    'gives a wheel gesture to the work log only when it can scroll in that direction (%j)',
    ({ top, deltaY, pinned }) => {
      const { viewport } = renderHarness()
      setScrollMetrics(viewport, 580, 1_000, 400)
      const workLog = document.createElement('div')
      workLog.setAttribute('data-scroll-follow-boundary', '')
      workLog.style.overflowY = 'auto'
      setScrollMetrics(workLog, top, 500, 200)
      viewport.append(workLog)

      fireEvent.wheel(workLog, { deltaY })
      fireEvent.scroll(workLog)

      expect(screen.getByTestId('jump-state').getAttribute('data-pinned')).toBe(String(pinned))
    },
  )

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps following when a delayed internal scroll event arrives after the content grew', async () => {
    stubReducedMotion(true)
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 600, 1000, 400)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))
    // The previous tail write's native event can arrive after the next render
    // has already increased the document height. Its offset is still ours.
    setScrollMetrics(viewport, 600, 1200, 400)
    fireEvent.scroll(viewport)
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-state').getAttribute('data-pinned')).toBe('true')
    await act(async () => {
      await Promise.resolve()
    })
    expect(viewport.scrollTop).toBe(800)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
  })

  it('lets a physical scroll-away cancel the delayed internal follow correction', async () => {
    stubReducedMotion(true)
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 600, 1000, 400)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))
    setScrollMetrics(viewport, 600, 1200, 400)
    fireEvent.scroll(viewport)
    fireEvent.wheel(viewport, { deltaY: -100 })
    viewport.scrollTop = 500
    fireEvent.scroll(viewport)
    await act(async () => {
      await Promise.resolve()
    })
    expect(viewport.scrollTop).toBe(500)
    expect(screen.getByTestId('jump-state').getAttribute('data-pinned')).toBe('false')
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it.each([
    { distance: 40, reducedMotion: false },
    { distance: 25_000, reducedMotion: false },
    { distance: 25_000, reducedMotion: true },
  ])(
    'jumps $distance pixels immediately with reduced motion set to $reducedMotion',
    ({ distance, reducedMotion }) => {
      stubReducedMotion(reducedMotion)
      const { viewport, scrollTo } = renderHarness()
      const start = 200
      const tail = start + distance
      setScrollMetrics(viewport, start, tail + 400, 400)
      fireEvent.wheel(viewport, { deltaY: -30 })
      expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')

      fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))

      expect(scrollTo).not.toHaveBeenCalled()
      expect(viewport.scrollTop).toBe(tail)
      expect(screen.getByTestId('jump-state').getAttribute('data-pinned')).toBe('true')
      expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
    },
  )

  it('still lets the reader scroll away after an explicit jump', () => {
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 200, 1_000, 400)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))

    expect(viewport.scrollTop).toBe(600)
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')

    // A later genuine user scroll away behaves exactly as before.
    viewport.scrollTop = 200
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it('does not treat a browser clamp during layout reconciliation as reader input', () => {
    vi.useFakeTimers()
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 600, 1_000, 400)

    // The reader starts pinned at the tail. A virtual canvas switch can clamp
    // the current offset before its measured height is reconciled. The layout
    // reconciliation must repair it synchronously, before the next paint.
    viewport.scrollTop = 0
    fireEvent.click(screen.getByRole('button', { name: 'Preserve layout' }))
    expect(viewport.scrollTop).toBe(600)
    fireEvent.scroll(viewport)

    act(() => {
      vi.runAllTimers()
    })

    expect(viewport.scrollTop).toBe(600)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')

    // Once a real gesture arrives, the temporary layout protection must no
    // longer be able to move the reader back to the tail.
    fireEvent.wheel(viewport, { deltaY: -30 })
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
    viewport.scrollTop = 570
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it('keeps a fitting conversation pinned and hides jump after wheel gestures in either direction', () => {
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 0, 600, 600)
    fireEvent.wheel(viewport, { deltaY: -80 })
    fireEvent.wheel(viewport, { deltaY: 80 })
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
    expect(screen.getByTestId('jump-state').getAttribute('data-pinned')).toBe('true')
  })

  it('hides jump after a clamped reveal or history capture when the tail is already visible', () => {
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 200, 1000, 400)
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal tail' }))
    expect(viewport.scrollTop).toBe(600)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Capture history' }))
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
  })

  it('rechecks visible overflow after resize without discarding a free reader position', () => {
    vi.useFakeTimers()
    const resize = stubViewportResize()
    const { viewport } = renderHarness()
    const content = screen.getByTestId('content')
    setScrollMetrics(viewport, 200, 1000, 400)
    act(() => {
      resize(viewport, 400)
      resize(content, 1000)
    })
    fireEvent.scroll(viewport)
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
    setScrollMetrics(viewport, 0, 600, 600)
    act(() => {
      resize(viewport, 600)
      resize(content, 600)
    })
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
    expect(screen.getByTestId('jump-state').getAttribute('data-pinned')).toBe('false')
    setScrollMetrics(viewport, 0, 1000, 600)
    act(() => resize(content, 1000))
    expect(viewport.scrollTop).toBe(200)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it('does not pull a free reader to the top when layout briefly clamps it', () => {
    vi.useFakeTimers()
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 640, 2_000, 400)

    fireEvent.wheel(viewport, { deltaY: -30 })
    viewport.scrollTop = 640
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')

    // A normal-flow/virtualized transition can transiently report the top
    // even though the reader was in the middle. The next layout reconciliation
    // must restore that reader position, never follow the tail.
    viewport.scrollTop = 0
    fireEvent.click(screen.getByRole('button', { name: 'Preserve layout' }))
    expect(viewport.scrollTop).toBe(640)
    fireEvent.scroll(viewport)
    act(() => {
      vi.runAllTimers()
    })

    expect(viewport.scrollTop).toBe(640)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it('does not reinterpret a middle reader position as a layout clamp', () => {
    vi.useFakeTimers()
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 600, 2_000, 400)

    // Arm the short layout-protection window while the reader is pinned, then
    // deliver a middle position. It is still an intentional reader position.
    fireEvent.click(screen.getByRole('button', { name: 'Preserve layout' }))
    viewport.scrollTop = 700
    fireEvent.scroll(viewport)
    act(() => {
      vi.runAllTimers()
    })

    expect(viewport.scrollTop).toBe(700)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it('keeps a pinned tail visible when a notification changes viewport height', () => {
    vi.useFakeTimers()
    const resize = stubViewportResize()
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 600, 1_000, 400)
    act(() => resize(viewport, 400))

    setScrollMetrics(viewport, 600, 1_000, 300)
    act(() => resize(viewport, 300))
    expect(viewport.scrollTop).toBe(700)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')

    setScrollMetrics(viewport, 700, 1_000, 400)
    act(() => resize(viewport, 400))
    expect(viewport.scrollTop).toBe(600)
  })

  it('does not mistake a native height clamp before ResizeObserver for a reader gesture', () => {
    vi.useFakeTimers()
    const resize = stubViewportResize()
    const { viewport } = renderHarness()
    const content = screen.getByTestId('content')
    setScrollMetrics(viewport, 600, 1_000, 400)
    act(() => {
      resize(viewport, 400)
      resize(content, 1_000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preserve layout' }))
    act(() => {
      vi.advanceTimersByTime(250)
    })
    // A shrinking composer expands the viewport. Chromium clamps the old tail
    // before the resize notification, without any wheel or pointer gesture.
    setScrollMetrics(viewport, 550, 1_000, 450)
    fireEvent.scroll(viewport)
    setScrollMetrics(viewport, 550, 1_100, 450)
    act(() => resize(content, 1_100))
    expect(viewport.scrollTop).toBe(650)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Preserve layout' }))
    fireEvent.scroll(viewport)
    fireEvent.scroll(viewport)
    setScrollMetrics(viewport, 650, 1_200, 450)
    act(() => resize(content, 1_200))
    expect(viewport.scrollTop).toBe(750)
  })

  it('keeps following after nonzero measurement clamps and duplicate Chromium scroll events', () => {
    vi.useFakeTimers()
    const { viewport } = renderHarness(true)
    setScrollMetrics(viewport, 600, 1_000, 400)
    fireEvent.click(screen.getByRole('button', { name: 'Preserve layout' }))
    viewport.scrollTop = 350
    fireEvent.scroll(viewport)
    fireEvent.scroll(viewport)
    act(() => {
      vi.runAllTimers()
    })
    expect(viewport.scrollTop).toBe(600)
    fireEvent.scroll(viewport)
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('false')
    fireEvent.wheel(viewport, { deltaY: -60 })
    viewport.scrollTop = 350
    fireEvent.scroll(viewport)
    act(() => {
      vi.runAllTimers()
    })
    expect(viewport.scrollTop).toBe(350)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it.each(['no input', 'before completion', 'during completion'])(
    'preserves scroll intent through content clamps and late resizes (%s)',
    async (readerInput) => {
      vi.useFakeTimers()
      stubReducedMotion(true)
      const resize = stubViewportResize()
      function Stream(): ReactElement {
        const follow = useScrollFollow({
          contentKey: 'same-reply',
          itemCount: 1,
          smoothTailGrowth: true,
        })
        return (
          <div ref={follow.scrollRef} data-testid="settling-viewport">
            <div ref={follow.contentRef} data-testid="settling-content" />
            <output data-testid="settling-jump" data-visible={follow.showJumpToLatest} />
          </div>
        )
      }
      render(<Stream />)
      const viewport = screen.getByTestId<HTMLDivElement>('settling-viewport')
      const content = screen.getByTestId('settling-content')
      setScrollMetrics(viewport, 600, 1000, 400)
      act(() => resize(content, 1000))
      await act(async () => Promise.resolve())

      // The live layout briefly shrinks and clamps the viewport before the
      // final layout grows to fit the reply and its footer.
      const scrolledBefore = readerInput === 'before completion'
      if (scrolledBefore) fireEvent.wheel(viewport, { deltaY: -40 })
      const position = scrolledBefore ? 540 : 560
      setScrollMetrics(viewport, position, 960, 400)
      fireEvent.scroll(viewport)
      setScrollMetrics(viewport, position, 1040, 400)
      act(() => resize(content, 1040))
      expect(viewport.scrollTop).toBe(scrolledBefore ? 540 : 640)

      setScrollMetrics(viewport, viewport.scrollTop, 1100, 400)
      act(() => resize(content, 1100))
      expect(viewport.scrollTop).toBe(scrolledBefore ? 540 : 700)
      act(() => {
        vi.advanceTimersByTime(500)
      })
      setScrollMetrics(viewport, scrolledBefore ? 540 : 680, 1112, 400)
      fireEvent.scroll(viewport)
      expect(viewport.scrollTop).toBe(scrolledBefore ? 540 : 712)

      // Chromium can deliver a clamp after the content has already grown
      // again, so the offset is below the current maximum.
      const scrolledDuring = readerInput === 'during completion'
      if (scrolledDuring) fireEvent.wheel(viewport, { deltaY: -30 })
      setScrollMetrics(viewport, scrolledBefore ? 540 : 670, 1124, 400)
      fireEvent.scroll(viewport)
      act(() => resize(content, 1124))
      expect(viewport.scrollTop).toBe(scrolledBefore ? 540 : scrolledDuring ? 670 : 724)
      expect(screen.getByTestId('settling-jump').getAttribute('data-visible')).toBe(
        String(scrolledBefore || scrolledDuring),
      )
    },
  )

  it('preserves a free reader across notification resizing', () => {
    vi.useFakeTimers()
    const resize = stubViewportResize()
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 200, 1_000, 400)
    act(() => resize(viewport, 400))
    fireEvent.scroll(viewport)
    act(() => {
      vi.runAllTimers()
    })

    setScrollMetrics(viewport, 200, 1_000, 300)
    act(() => resize(viewport, 300))
    expect(viewport.scrollTop).toBe(200)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })

  it('does not overwrite a gesture before its native scroll event arrives', () => {
    vi.useFakeTimers()
    const resize = stubViewportResize()
    const { viewport } = renderHarness()
    setScrollMetrics(viewport, 600, 1_000, 400)
    act(() => resize(viewport, 400))
    const content = screen.getByTestId('content')
    act(() => resize(content, 1_000))
    fireEvent.wheel(viewport, { deltaY: -30 })
    setScrollMetrics(viewport, 500, 1_400, 300)

    act(() => {
      resize(viewport, 300)
      resize(content, 1_400)
    })
    expect(viewport.scrollTop).toBe(500)
    fireEvent.scroll(viewport)
    act(() => {
      vi.runAllTimers()
    })
    expect(viewport.scrollTop).toBe(500)
    expect(screen.getByTestId('jump-state').getAttribute('data-visible')).toBe('true')
  })
})

function stubViewportResize(): (target: Element, height: number, width?: number) => void {
  let notify: ((entry: ResizeObserverEntry) => void) | undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = (entry) => callback([entry], this)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  return (target, height, width = 240) => {
    if (notify === undefined) throw new Error('Viewport is not observed')
    notify({ target, contentRect: new DOMRect(0, 0, width, height) } as ResizeObserverEntry)
  }
}

function renderHarness(layoutMeasurementsActive = false): {
  viewport: HTMLDivElement
  scrollTo: ReturnType<typeof vi.fn>
} {
  function Harness(): ReactElement {
    const follow = useScrollFollow({
      contentKey: 'tail',
      itemCount: 1,
      sessionId: 'session-1',
      layoutMeasurementsActive,
    })
    return (
      <>
        <div ref={follow.scrollRef} data-testid="viewport" onScroll={follow.handleScroll}>
          <div ref={follow.contentRef} data-testid="content" />
        </div>
        <button type="button" onClick={follow.userScrollToLatest}>
          Jump to latest
        </button>
        <button type="button" onClick={() => follow.userScrollToOffset(9000)}>
          Reveal tail
        </button>
        <button type="button" onClick={() => follow.captureScrollAnchor()}>
          Capture history
        </button>
        <button
          type="button"
          onClick={() => follow.scheduleScrollToLatest({ preserveBottom: true, immediate: true })}
        >
          Preserve layout
        </button>
        <output
          data-testid="jump-state"
          data-visible={follow.showJumpToLatest}
          data-pinned={follow.isPinnedToBottom}
        />
      </>
    )
  }

  render(<Harness />)
  const viewport = screen.getByTestId<HTMLDivElement>('viewport')
  const scrollTo = vi.fn()
  viewport.scrollTo = scrollTo
  viewport.scrollTop = 200
  return { viewport, scrollTo }
}

function setScrollMetrics(
  element: HTMLDivElement,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): void {
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => (scrollTop = value),
  })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
}

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

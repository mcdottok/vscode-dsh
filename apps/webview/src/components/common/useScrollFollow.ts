import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

const DEFAULT_BOTTOM_THRESHOLD = 64
const WHEEL_TAIL_DISTANCE = 32
const USER_SCROLL_IDLE_MS = 220
const STREAM_FOLLOW_DAMPING_MS = 36
const MAX_FOLLOW_SPEED_PX_PER_MS = 2
const INITIAL_PLACEMENT_STABLE_FRAMES = 2
const INITIAL_PLACEMENT_MAX_FRAMES = 8
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])

interface ScheduledFollow {
  readonly cancel: () => void
}

export interface ScrollFollowOptions {
  /** A stable identity for the append-only stream being displayed. */
  readonly contentKey: string | number
  /** The number of records currently available in the scroll owner. */
  readonly itemCount: number
  /** Reset the reader to the tail when the displayed session changes. */
  readonly sessionId?: string | undefined
  /** Distance from the tail at which the reader is still considered pinned. */
  readonly bottomThreshold?: number
  /**
   * Observe consumer content size changes for late layout growth. Long
   * virtualized collections opt out because their measurement pass changes
   * the estimated canvas height while the reader is moving.
   */
  readonly observeContentSize?: boolean
  /** A virtual canvas may clamp a pinned offset while its estimates settle. */
  readonly layoutMeasurementsActive?: boolean
  /** Reattach to an actively growing conversation when a downward wheel reaches its tail. */
  readonly snapToTailOnWheel?: boolean
  /** Ease toward a growing tail, including size changes outside React commits. */
  readonly smoothTailGrowth?: boolean
}

/** A reader position captured before an older history page is inserted. */
export interface ScrollAnchor {
  readonly contentHeight: number
  readonly scrollTop: number
  readonly interactionGeneration: number
  readonly nodeId?: string
  readonly nodeOffset?: number
}

export interface ScrollFollowResult {
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly contentRef: RefObject<HTMLDivElement | null>
  readonly handleScroll: () => void
  readonly scrollToLatest: () => void
  /** Jump directly to the tail and supersede pending reader navigation. */
  readonly userScrollToLatest: () => void
  /** A deliberate reader navigation, such as revealing a selected Inspector row. */
  readonly userScrollToOffset: (offset: number) => void
  /** Capture the current position for a guarded prepend restoration. */
  readonly captureScrollAnchor: () => ScrollAnchor | undefined
  /** Restore a captured prepend position only while the reader is still there. */
  readonly restoreScrollAnchor: (anchor: ScrollAnchor, allowLayoutShift?: boolean) => boolean
  /** Apply a virtualizer's measured-height delta without changing reader mode. */
  readonly applyScrollAdjustment: (delta: number) => void
  /** Whether the latest scroll was caused by an active reader gesture. */
  readonly isUserScrollActive: () => boolean
  /** Reconcile after a consumer-owned layout measurement changes its height. */
  readonly scheduleScrollToLatest: (options?: ScrollFollowScheduleOptions) => void
  /** Whether the browser is currently following the append-only tail. */
  readonly isPinnedToBottom: boolean
  readonly showJumpToLatest: boolean
}

export interface ScrollFollowScheduleOptions {
  /**
   * Preserve an already pinned reader while a consumer changes layout. The
   * next native scroll event can be caused by browser clamping rather than a
   * physical reader gesture, so keep the tail intent until reconciliation.
   */
  readonly preserveBottom?: boolean
  /** Correct a known layout transition before the browser paints it. */
  readonly immediate?: boolean
  /** Place an initially opened or switched conversation at its tail immediately. */
  readonly snap?: boolean
}

/**
 * Owns the scroll contract shared by append-only conversation surfaces.
 *
 * There is deliberately one scroll-position writer. Ordinary resize and
 * content updates coalesce within the current turn; known layout transitions
 * are corrected synchronously before paint. Captured wheel, pointer and keyboard
 * gestures cancel a pending follow before native scrolling takes effect.
 */
export function useScrollFollow(options: ScrollFollowOptions): ScrollFollowResult {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const previousSessionRef = useRef(options.sessionId)
  const scheduledFrameRef = useRef<ScheduledFollow | undefined>(undefined)
  const userScrollIdleTimerRef = useRef<number | undefined>(undefined)
  const userScrollActiveRef = useRef(false)
  const interactionGenerationRef = useRef(0)
  const internalScrollTopRef = useRef<number | undefined>(undefined)
  const lastReaderScrollTopRef = useRef<number | undefined>(undefined)
  const viewportHeightRef = useRef(0)
  const measuredTailRef = useRef<number | undefined>(undefined)
  const positionedSessionRef = useRef(false)
  const initialPlacementFrameRef = useRef<number | undefined>(undefined)
  const preserveBottomOnLayoutRef = useRef(false)
  const layoutProtectionTimerRef = useRef<number | undefined>(undefined)
  const smoothTailGrowth = options.smoothTailGrowth === true
  const tailMotionRef = useRef<{ frame: number; target: number; position: number } | undefined>(undefined)
  const scrollHandlerRef = useRef<() => void>(() => undefined)
  const itemCountRef = useRef(options.itemCount)
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const jumpVisibilityRef = useRef(showJumpToLatest)
  useLayoutEffect(() => {
    jumpVisibilityRef.current = showJumpToLatest
  }, [showJumpToLatest])
  const bottomThreshold = options.bottomThreshold ?? DEFAULT_BOTTOM_THRESHOLD

  const updateJumpVisibility = useCallback((): void => {
    const element = scrollRef.current
    // Reader intent and visible overflow are separate. A wheel gesture, an
    // Inspector reveal or a shrinking process can leave a free reader with
    // no content below the viewport, in which case there is nowhere to jump.
    const next =
      !stickToBottomRef.current &&
      itemCountRef.current > 0 &&
      element !== null &&
      element.clientHeight > 0 &&
      element.scrollHeight - element.clientHeight - element.scrollTop > 1
    // A no-op state update from a layout/resize callback can still schedule a
    // synchronous render while another update is pending. Avoid entering
    // React at all for the common pinned streaming path.
    if (jumpVisibilityRef.current === next) return
    jumpVisibilityRef.current = next
    setShowJumpToLatest(next)
  }, [])

  const cancelScheduledFollow = useCallback((): void => {
    const scheduled = scheduledFrameRef.current
    if (scheduled === undefined) return
    scheduled.cancel()
    scheduledFrameRef.current = undefined
  }, [])

  const cancelTailMotion = useCallback((): void => {
    const follow = tailMotionRef.current
    if (follow === undefined) return
    window.cancelAnimationFrame(follow.frame)
    tailMotionRef.current = undefined
  }, [])

  const cancelInitialPlacement = useCallback((): void => {
    const frame = initialPlacementFrameRef.current
    if (frame === undefined) return
    window.cancelAnimationFrame(frame)
    initialPlacementFrameRef.current = undefined
  }, [])

  const clearUserScrollLock = useCallback((): void => {
    if (userScrollIdleTimerRef.current !== undefined) {
      window.clearTimeout(userScrollIdleTimerRef.current)
      userScrollIdleTimerRef.current = undefined
    }
    userScrollActiveRef.current = false
  }, [])

  const clearLayoutProtection = useCallback((): void => {
    if (layoutProtectionTimerRef.current !== undefined) {
      window.clearTimeout(layoutProtectionTimerRef.current)
      layoutProtectionTimerRef.current = undefined
    }
    preserveBottomOnLayoutRef.current = false
  }, [])

  const armLayoutProtection = useCallback((): void => {
    if (layoutProtectionTimerRef.current !== undefined) window.clearTimeout(layoutProtectionTimerRef.current)
    layoutProtectionTimerRef.current = window.setTimeout(() => {
      layoutProtectionTimerRef.current = undefined
      preserveBottomOnLayoutRef.current = false
    }, USER_SCROLL_IDLE_MS)
  }, [])

  const restoreReaderPosition = useCallback((allowDuringGesture = false): boolean => {
    const element = scrollRef.current
    const savedScrollTop = lastReaderScrollTopRef.current
    if (
      element === null ||
      savedScrollTop === undefined ||
      stickToBottomRef.current ||
      (userScrollActiveRef.current && !allowDuringGesture)
    )
      return false

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    if (savedScrollTop > 1 && maxScrollTop <= 1) return false
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, savedScrollTop))
    if (Math.abs(element.scrollTop - nextScrollTop) > 0.5) {
      internalScrollTopRef.current = nextScrollTop
      element.scrollTop = nextScrollTop
    } else internalScrollTopRef.current = undefined
    lastReaderScrollTopRef.current = nextScrollTop
    return true
  }, [])

  const applyScrollAdjustment = useCallback(
    (delta: number): void => {
      if (!Number.isFinite(delta) || Math.abs(delta) <= 0.5) return
      const element = scrollRef.current
      if (element === null) return
      // The canvas resize reconciles the measured tail. Applying its adjustment
      // here would move the pinned viewport before the animation can start.
      if (smoothTailGrowth && stickToBottomRef.current && !userScrollActiveRef.current) return

      // If a virtualized canvas was briefly collapsed, the DOM can report zero
      // even though the reader was stably in the middle. Continue from the last
      // reader position so a measurement delta cannot turn that clamp into a
      // jump to the top. During an active gesture, the live DOM value wins.
      const savedScrollTop = lastReaderScrollTopRef.current
      const isCollapsedFreeReader =
        !stickToBottomRef.current &&
        !userScrollActiveRef.current &&
        element.scrollTop <= 1 &&
        savedScrollTop !== undefined &&
        savedScrollTop > 1
      const baseScrollTop = isCollapsedFreeReader ? (savedScrollTop ?? 0) : element.scrollTop
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      if (isCollapsedFreeReader && maxScrollTop <= 1) return
      const nextScrollTop = Math.min(maxScrollTop, Math.max(0, baseScrollTop + delta))
      internalScrollTopRef.current = nextScrollTop
      element.scrollTop = nextScrollTop
      lastReaderScrollTopRef.current = nextScrollTop
    },
    [smoothTailGrowth],
  )

  const scrollToLatest = useCallback((): void => {
    clearUserScrollLock()
    cancelScheduledFollow()
    cancelTailMotion()
    const element = scrollRef.current
    if (element === null) return

    stickToBottomRef.current = true
    setIsPinnedToBottom(true)
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    measuredTailRef.current = maxScrollTop
    // Retain ownership even if layout already clamped to this offset. Chromium
    // can still deliver the pending scroll event after the resize callback.
    internalScrollTopRef.current = maxScrollTop
    if (Math.abs(element.scrollTop - maxScrollTop) > 0.5) {
      element.scrollTop = maxScrollTop
    }
    lastReaderScrollTopRef.current = maxScrollTop
    viewportHeightRef.current = element.clientHeight
    setShowJumpToLatest(false)
  }, [cancelScheduledFollow, cancelTailMotion, clearUserScrollLock])

  const settleInitialPlacement = useCallback((): void => {
    const element = scrollRef.current
    if (
      element === null ||
      element.clientHeight === 0 ||
      !smoothTailGrowth ||
      document.visibilityState === 'hidden' ||
      typeof window.requestAnimationFrame !== 'function'
    )
      return

    // Opening a conversation can mount and measure several virtual ranges.
    // Keep the initial placement through those frames, then let later content
    // growth use normal follow motion. Bound the window for an already live reply.
    let previousHeight = element.scrollHeight
    let previousViewport = element.clientHeight
    let stableFrames = 0
    let remaining = INITIAL_PLACEMENT_MAX_FRAMES
    const check = (): void => {
      initialPlacementFrameRef.current = undefined
      if (scrollRef.current !== element || !stickToBottomRef.current || userScrollActiveRef.current) return
      const height = element.scrollHeight
      const viewport = element.clientHeight
      const misplaced = Math.abs(Math.max(0, height - viewport) - element.scrollTop) > 1
      stableFrames =
        height === previousHeight && viewport === previousViewport && !misplaced ? stableFrames + 1 : 0
      previousHeight = height
      previousViewport = viewport
      if (misplaced) scrollToLatest()
      if (--remaining > 0 && stableFrames < INITIAL_PLACEMENT_STABLE_FRAMES)
        initialPlacementFrameRef.current = window.requestAnimationFrame(check)
    }
    initialPlacementFrameRef.current = window.requestAnimationFrame(check)
  }, [scrollToLatest, smoothTailGrowth])

  const followGrowth = useCallback((): void => {
    if (
      initialPlacementFrameRef.current !== undefined ||
      !smoothTailGrowth ||
      document.visibilityState === 'hidden' ||
      typeof window.requestAnimationFrame !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    ) {
      scrollToLatest()
      return
    }
    const element = scrollRef.current
    if (element === null) return
    const viewportHeight = element.clientHeight
    const target = Math.max(0, element.scrollHeight - viewportHeight)
    const scrollTop = element.scrollTop
    measuredTailRef.current = target
    const distance = target - scrollTop
    if (distance <= 1) {
      scrollToLatest()
      return
    }
    const active = tailMotionRef.current
    if (active !== undefined && Math.abs(active.position - scrollTop) <= 1) {
      active.target = target
      return
    }

    // A shrinking scrollport may clamp the last animated offset before
    // the next size notification. Continue from the actual browser position.
    cancelTailMotion()
    let velocity = 0
    let previousFrame = window.performance.now()
    const tick = (timestamp: number): void => {
      const follow = tailMotionRef.current
      if (follow === undefined) return
      if (scrollRef.current !== element || !stickToBottomRef.current || userScrollActiveRef.current) {
        cancelTailMotion()
        return
      }
      const elapsed = Math.min(32, Math.max(0, timestamp - previousFrame))
      previousFrame = timestamp
      const remaining = follow.target - follow.position
      // A critically damped spring starts gently and keeps its velocity
      // when another line grows the tail before the previous motion settles.
      const decay = Math.exp(-elapsed / STREAM_FOLLOW_DAMPING_MS)
      const transient = (remaining / STREAM_FOLLOW_DAMPING_MS - velocity) * elapsed
      const nextRemaining = (remaining + transient) * decay
      velocity = (velocity + transient / STREAM_FOLLOW_DAMPING_MS) * decay
      const easedPosition = nextRemaining <= 0.5 ? follow.target : follow.target - nextRemaining
      follow.position = Math.min(
        follow.position + MAX_FOLLOW_SPEED_PX_PER_MS * elapsed,
        Math.max(follow.position, easedPosition),
      )
      internalScrollTopRef.current = follow.position
      lastReaderScrollTopRef.current = follow.position
      element.scrollTop = follow.position
      if (follow.position < follow.target) follow.frame = window.requestAnimationFrame(tick)
      else tailMotionRef.current = undefined
    }
    viewportHeightRef.current = viewportHeight
    tailMotionRef.current = { frame: window.requestAnimationFrame(tick), target, position: scrollTop }
  }, [cancelTailMotion, scrollToLatest, smoothTailGrowth])

  const userScrollToLatest = useCallback((): void => {
    interactionGenerationRef.current += 1
    cancelInitialPlacement()
    clearLayoutProtection()
    scrollToLatest()
  }, [cancelInitialPlacement, clearLayoutProtection, scrollToLatest])

  const userScrollToOffset = useCallback(
    (offset: number): void => {
      if (!Number.isFinite(offset)) return
      cancelInitialPlacement()
      clearLayoutProtection()
      clearUserScrollLock()
      cancelScheduledFollow()
      cancelTailMotion()
      const element = scrollRef.current
      if (element === null) return
      interactionGenerationRef.current += 1
      stickToBottomRef.current = false
      setIsPinnedToBottom(false)
      const next = Math.min(Math.max(0, element.scrollHeight - element.clientHeight), Math.max(0, offset))
      internalScrollTopRef.current = next
      lastReaderScrollTopRef.current = next
      element.scrollTop = next
      updateJumpVisibility()
    },
    [
      cancelInitialPlacement,
      cancelScheduledFollow,
      cancelTailMotion,
      clearLayoutProtection,
      clearUserScrollLock,
      updateJumpVisibility,
    ],
  )

  const scheduleScrollToLatest = useCallback(
    (scheduleOptions?: ScrollFollowScheduleOptions): void => {
      // A free reader may be clamped by a normal-flow/virtualized-canvas
      // transition. Restore the last observed reader position first; this
      // path never changes a free reader into tail-following mode.
      restoreReaderPosition(scheduleOptions?.preserveBottom === true)
      updateJumpVisibility()
      const preserveBottom =
        scheduleOptions?.preserveBottom === true &&
        stickToBottomRef.current &&
        !userScrollActiveRef.current &&
        itemCountRef.current > 0
      if (preserveBottom) preserveBottomOnLayoutRef.current = true
      if (preserveBottom && scheduleOptions?.immediate === true) {
        // Reconcile before paint, using the same follow motion for text,
        // footer and viewport changes throughout a reply.
        cancelScheduledFollow()
        if (scheduleOptions.snap === true) scrollToLatest()
        else followGrowth()
        armLayoutProtection()
        return
      }
      const shouldFollow = stickToBottomRef.current || preserveBottomOnLayoutRef.current
      if (userScrollActiveRef.current || !shouldFollow || itemCountRef.current === 0) return
      // Reconcile the latest committed layout once per turn, without a timer
      // or frame wait. A captured reader gesture can still cancel this write.
      if (scheduledFrameRef.current !== undefined) return
      const scheduledGeneration = interactionGenerationRef.current

      const run = (): void => {
        scheduledFrameRef.current = undefined
        const preserveBottom = preserveBottomOnLayoutRef.current
        if (
          scheduledGeneration === interactionGenerationRef.current &&
          !userScrollActiveRef.current &&
          (stickToBottomRef.current || preserveBottom)
        ) {
          if (preserveBottom) {
            stickToBottomRef.current = true
            setIsPinnedToBottom(true)
          }
          if (scheduleOptions?.snap === true) scrollToLatest()
          else followGrowth()
          if (preserveBottom) armLayoutProtection()
        }
      }

      let cancelled = false
      scheduledFrameRef.current = {
        cancel: () => {
          cancelled = true
        },
      }
      queueMicrotask(() => {
        if (!cancelled) run()
      })
    },
    [
      armLayoutProtection,
      cancelScheduledFollow,
      followGrowth,
      restoreReaderPosition,
      scrollToLatest,
      updateJumpVisibility,
    ],
  )

  const captureScrollAnchor = useCallback((): ScrollAnchor | undefined => {
    const element = scrollRef.current
    if (element === null) return undefined
    cancelInitialPlacement()
    cancelScheduledFollow()
    cancelTailMotion()
    clearLayoutProtection()
    // Loading earlier content is a deliberate departure from append-follow.
    stickToBottomRef.current = false
    setIsPinnedToBottom(false)
    updateJumpVisibility()
    lastReaderScrollTopRef.current = element.scrollTop
    const top = element.getBoundingClientRect().top
    const row = [...element.querySelectorAll<HTMLElement>('[data-node-id]')].find(
      (node) => node.getBoundingClientRect().bottom > top,
    )
    return {
      ...(row?.dataset.nodeId === undefined
        ? {}
        : { nodeId: row.dataset.nodeId, nodeOffset: row.getBoundingClientRect().top - top }),
      contentHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      interactionGeneration: interactionGenerationRef.current,
    }
  }, [
    cancelInitialPlacement,
    cancelScheduledFollow,
    cancelTailMotion,
    clearLayoutProtection,
    updateJumpVisibility,
  ])

  const restoreScrollAnchor = useCallback((anchor: ScrollAnchor, allowLayoutShift = false): boolean => {
    const element = scrollRef.current
    if (element === null || anchor.interactionGeneration !== interactionGenerationRef.current) return false

    // A native gesture may have happened before its scroll event reaches
    // React. Do not overwrite that newer reader position just because an
    // older history request completed.
    if (!allowLayoutShift && Math.abs(element.scrollTop - anchor.scrollTop) > 1) return false

    const row =
      anchor.nodeId === undefined
        ? undefined
        : [...element.querySelectorAll<HTMLElement>('[data-node-id]')].find(
            (node) => node.dataset.nodeId === anchor.nodeId,
          )
    const heightDelta =
      row !== undefined && anchor.nodeOffset !== undefined
        ? row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.nodeOffset
        : element.scrollHeight - anchor.contentHeight
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    const baseScrollTop = row !== undefined && allowLayoutShift ? element.scrollTop : anchor.scrollTop
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, baseScrollTop + heightDelta))
    if (Math.abs(element.scrollTop - nextScrollTop) > 0.5) {
      internalScrollTopRef.current = nextScrollTop
      element.scrollTop = nextScrollTop
    } else internalScrollTopRef.current = undefined
    lastReaderScrollTopRef.current = nextScrollTop
    return true
  }, [])

  const isUserScrollActive = useCallback((): boolean => userScrollActiveRef.current, [])

  const armUserScrollLock = useCallback((): void => {
    cancelInitialPlacement()
    cancelTailMotion()
    clearLayoutProtection()
    internalScrollTopRef.current = undefined
    if (!userScrollActiveRef.current) interactionGenerationRef.current += 1
    userScrollActiveRef.current = true
    if (userScrollIdleTimerRef.current !== undefined) window.clearTimeout(userScrollIdleTimerRef.current)
    userScrollIdleTimerRef.current = window.setTimeout(() => {
      userScrollIdleTimerRef.current = undefined
      userScrollActiveRef.current = false
      if (stickToBottomRef.current && itemCountRef.current > 0) scheduleScrollToLatest()
    }, USER_SCROLL_IDLE_MS)
  }, [cancelInitialPlacement, cancelTailMotion, clearLayoutProtection, scheduleScrollToLatest])

  const handleScroll = useCallback((): void => {
    const element = scrollRef.current
    if (element === null) return
    const expectedScrollTop = internalScrollTopRef.current
    const isInternalScroll =
      expectedScrollTop !== undefined && Math.abs(element.scrollTop - expectedScrollTop) <= 1
    // The native event for our previous tail write may be delivered after a
    // newer render has grown the content. Its offset still belongs to us;
    // distance from the new tail must not turn it into a reader scroll-away.
    const isInternalFollowScroll =
      isInternalScroll && stickToBottomRef.current && !userScrollActiveRef.current
    if (isInternalFollowScroll && tailMotionRef.current !== undefined) return
    if (!isInternalScroll) internalScrollTopRef.current = undefined
    if (isInternalScroll) lastReaderScrollTopRef.current = element.scrollTop
    // Chromium can deliver several scroll events for the same internal write;
    // retain its expected offset until a different offset or reader gesture.
    // A measured virtual canvas can also clamp to a nonzero estimate. Limit
    // that exception to the owning consumer's guarded layout reconciliation;
    // ordinary readers and all captured physical gestures keep control.
    const viewportResized =
      viewportHeightRef.current > 0 && viewportHeightRef.current !== element.clientHeight
    viewportHeightRef.current = element.clientHeight
    const isViewportLayoutScroll = stickToBottomRef.current && viewportResized && !userScrollActiveRef.current
    const scrollLimit = Math.max(0, element.scrollHeight - element.clientHeight)
    const distanceFromBottom = scrollLimit - element.scrollTop
    const tailResized =
      measuredTailRef.current !== undefined && Math.abs(scrollLimit - measuredTailRef.current) > 1
    const isTailClamp =
      stickToBottomRef.current &&
      !userScrollActiveRef.current &&
      expectedScrollTop !== undefined &&
      expectedScrollTop - element.scrollTop > 1 &&
      (distanceFromBottom <= 1 || (smoothTailGrowth && (tailResized || preserveBottomOnLayoutRef.current)))
    if (isViewportLayoutScroll || isTailClamp) {
      if (!isInternalScroll) cancelTailMotion()
      internalScrollTopRef.current = element.scrollTop
      lastReaderScrollTopRef.current = element.scrollTop
    }
    const isLayoutScroll =
      !userScrollActiveRef.current &&
      (isViewportLayoutScroll ||
        isTailClamp ||
        (preserveBottomOnLayoutRef.current &&
          (element.scrollTop <= 1 ||
            (options.layoutMeasurementsActive === true && stickToBottomRef.current))))
    if (!isInternalScroll && !isLayoutScroll) {
      // Scroll events are the final source of truth. They also cover input
      // paths that do not reliably expose wheel/pointer intent in a Webview.
      cancelScheduledFollow()
      // Refresh the lock for every physical scroll event. A pointer drag or
      // inertial trackpad sequence can last longer than one idle interval;
      // allowing the first timer to expire during that sequence hands control
      // back to the append follower while the reader is still moving.
      armUserScrollLock()
      lastReaderScrollTopRef.current = element.scrollTop
    }
    // During a native gesture, only an actual arrival at the tail can
    // re-enable append-follow. Using the relaxed reader threshold here would
    // turn a small intentional scroll-away into a delayed snap-back when the
    // gesture lock expires.
    const pinThreshold = userScrollActiveRef.current ? 1 : bottomThreshold
    const atLatest = isLayoutScroll || isInternalFollowScroll || distanceFromBottom <= pinThreshold
    stickToBottomRef.current = atLatest
    setIsPinnedToBottom((current) => (current === atLatest ? current : atLatest))
    if (!atLatest) cancelScheduledFollow()
    if ((isLayoutScroll || (isInternalFollowScroll && distanceFromBottom > 1)) && itemCountRef.current > 0)
      scheduleScrollToLatest({
        preserveBottom: true,
        immediate: isTailClamp || distanceFromBottom > 1,
      })
    updateJumpVisibility()
  }, [
    armUserScrollLock,
    bottomThreshold,
    cancelScheduledFollow,
    cancelTailMotion,
    options.layoutMeasurementsActive,
    scheduleScrollToLatest,
    smoothTailGrowth,
    updateJumpVisibility,
  ])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element !== null && lastReaderScrollTopRef.current === undefined)
      lastReaderScrollTopRef.current = element.scrollTop
    if (element !== null && viewportHeightRef.current <= 0) viewportHeightRef.current = element.clientHeight
    itemCountRef.current = options.itemCount
    scrollHandlerRef.current = handleScroll
  }, [handleScroll, options.itemCount])

  const handleWheel = useCallback(
    (event: Pick<WheelEvent, 'deltaY'>): void => {
      if (event.deltaY === 0) return
      const element = scrollRef.current
      if (element === null || element.scrollHeight - element.clientHeight <= 1) {
        updateJumpVisibility()
        return
      }
      cancelScheduledFollow()
      armUserScrollLock()

      // A downward wheel at the tail has no scrollable destination and should
      // keep the append-only follow active. Every other wheel gesture is a
      // reader intent until the subsequent native scroll event recalculates
      // the exact position.
      const remainsAtLatest =
        event.deltaY > 0 && element.scrollHeight - element.scrollTop - element.clientHeight <= 1
      if (remainsAtLatest) {
        updateJumpVisibility()
        return
      }

      stickToBottomRef.current = false
      setIsPinnedToBottom(false)
      updateJumpVisibility()
    },
    [armUserScrollLock, cancelScheduledFollow, updateJumpVisibility],
  )

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    const isNestedScrollGesture = (event: Event): boolean => {
      if (!(event.target instanceof Element)) return false
      const boundary = event.target.closest('[data-scroll-follow-boundary]')
      return (
        boundary !== null &&
        boundary !== element &&
        element.contains(boundary) &&
        boundary.scrollHeight - boundary.clientHeight > 1
      )
    }
    const onWheel = (event: WheelEvent): void => {
      if (isNestedScrollGesture(event) || event.defaultPrevented || event.ctrlKey || event.shiftKey) return
      const { deltaMode, deltaX, deltaY } = event
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return
      if (options.snapToTailOnWheel && event.cancelable && deltaY > 0) {
        let distance = deltaY
        if (deltaMode === 1) distance *= Number.parseFloat(getComputedStyle(element).lineHeight) || 16
        if (deltaMode === 2) distance *= element.clientHeight
        const maxTop = element.scrollHeight - element.clientHeight
        if (maxTop > 1 && maxTop - element.scrollTop <= distance + WHEEL_TAIL_DISTANCE) {
          for (
            let target = event.target instanceof Element ? event.target : null;
            target !== null && target !== element;
            target = target.parentElement
          ) {
            const remaining = target.scrollHeight - target.clientHeight
            if (remaining <= 1) continue
            const style = getComputedStyle(target)
            if (
              /^(auto|scroll)$/u.test(style.overflowY) &&
              (remaining - target.scrollTop > 1 || /^(contain|none)$/u.test(style.overscrollBehaviorY))
            )
              return
          }
          // Reattach against the current layout before another chunk can move
          // the tail or the native wheel animation can leave a stale offset.
          event.preventDefault()
          scrollToLatest()
          return
        }
      }
      handleWheel(event)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || isNestedScrollGesture(event)) return
      cancelScheduledFollow()
      armUserScrollLock()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!SCROLL_KEYS.has(event.key) || isNestedScrollGesture(event)) return
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return
      cancelScheduledFollow()
      armUserScrollLock()
    }
    const onScrollEnd = (event: Event): void => {
      if (event.target !== element) return
      if (!userScrollActiveRef.current) return
      clearUserScrollLock()
      if (stickToBottomRef.current && itemCountRef.current > 0) scheduleScrollToLatest()
    }
    // Capture the gesture on the scroll owner itself, before React's delegated
    // listener and before the browser applies the native scroll offset. The
    // pointer path also covers scrollbar dragging, which has no wheel event.
    const onScroll = (event: Event): void => {
      if (event.target === element) scrollHandlerRef.current()
    }
    element.addEventListener('wheel', onWheel, { capture: true, passive: !options.snapToTailOnWheel })
    element.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    element.addEventListener('keydown', onKeyDown, { capture: true })
    element.addEventListener('scroll', onScroll, { capture: true, passive: true })
    element.addEventListener('scrollend', onScrollEnd, { capture: true, passive: true })
    return () => {
      element.removeEventListener('wheel', onWheel, true)
      element.removeEventListener('pointerdown', onPointerDown, true)
      element.removeEventListener('keydown', onKeyDown, true)
      element.removeEventListener('scroll', onScroll, true)
      element.removeEventListener('scrollend', onScrollEnd, true)
    }
  }, [
    armUserScrollLock,
    cancelScheduledFollow,
    clearUserScrollLock,
    handleWheel,
    options.snapToTailOnWheel,
    scheduleScrollToLatest,
    scrollToLatest,
  ])

  useLayoutEffect(
    () => () => {
      cancelInitialPlacement()
      clearLayoutProtection()
      clearUserScrollLock()
      cancelTailMotion()
    },
    [cancelInitialPlacement, cancelTailMotion, clearLayoutProtection, clearUserScrollLock],
  )

  useLayoutEffect(() => {
    const sessionChanged = previousSessionRef.current !== options.sessionId
    if (sessionChanged) {
      cancelInitialPlacement()
      clearUserScrollLock()
      previousSessionRef.current = options.sessionId
      positionedSessionRef.current = false
      stickToBottomRef.current = true
      setIsPinnedToBottom(true)
      setShowJumpToLatest(false)
    } else restoreReaderPosition(true)
    updateJumpVisibility()
    if (stickToBottomRef.current && options.itemCount > 0) {
      const initialPlacement = sessionChanged || (smoothTailGrowth && !positionedSessionRef.current)
      positionedSessionRef.current = true
      scheduleScrollToLatest({
        preserveBottom: true,
        immediate: initialPlacement,
        snap: initialPlacement,
      })
      if (initialPlacement) settleInitialPlacement()
    }
  }, [
    cancelInitialPlacement,
    clearUserScrollLock,
    options.contentKey,
    options.itemCount,
    options.sessionId,
    restoreReaderPosition,
    scheduleScrollToLatest,
    settleInitialPlacement,
    smoothTailGrowth,
    updateJumpVisibility,
  ])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return

    const content = contentRef.current
    let contentHeight: number | undefined
    const viewportSizes = { width: 0, height: 0 }
    const observer = new ResizeObserver((entries) => {
      let resized = false
      for (const entry of entries) {
        if (entry.target === element) {
          const { width, height } = entry.contentRect
          const changed =
            Math.abs(width - viewportSizes.width) >= 0.5 || Math.abs(height - viewportSizes.height) >= 0.5
          const measured = viewportSizes.width > 0
          viewportSizes.width = width
          viewportSizes.height = height
          if (viewportHeightRef.current <= 0) viewportHeightRef.current = element.clientHeight
          // Notifications and in-flow helpers resize the scroll owner without
          // changing its content. Reconcile only through the existing intent
          // guard: a free reader or an active gesture always keeps control.
          if (measured && changed) resized = true
          continue
        }
        if (entry.target !== content) continue
        const { height } = entry.contentRect
        const heightChanged =
          contentHeight === undefined ? smoothTailGrowth : Math.abs(height - contentHeight) >= 0.5
        if (heightChanged) resized = true
        contentHeight = height
      }
      if (resized && !userScrollActiveRef.current)
        scheduleScrollToLatest({ preserveBottom: true, immediate: true })
      else updateJumpVisibility()
    })
    observer.observe(element)
    if (options.observeContentSize !== false && content !== null && content !== element)
      observer.observe(content)
    return () => {
      observer.disconnect()
      cancelScheduledFollow()
    }
  }, [
    cancelScheduledFollow,
    options.observeContentSize,
    options.sessionId,
    scheduleScrollToLatest,
    smoothTailGrowth,
    updateJumpVisibility,
  ])

  useLayoutEffect(() => cancelScheduledFollow, [cancelScheduledFollow])

  return {
    scrollRef,
    contentRef,
    handleScroll,
    scrollToLatest,
    userScrollToLatest,
    userScrollToOffset,
    captureScrollAnchor,
    restoreScrollAnchor,
    applyScrollAdjustment,
    isUserScrollActive,
    scheduleScrollToLatest,
    isPinnedToBottom,
    showJumpToLatest,
  }
}

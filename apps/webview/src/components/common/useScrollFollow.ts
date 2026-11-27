import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { motionScale } from '../../app/motion.js'

const DEFAULT_BOTTOM_THRESHOLD = 64
const WHEEL_TAIL_DISTANCE = 32
const USER_SCROLL_IDLE_MS = 220
const LAYOUT_SETTLE_MS = 220
const STREAM_FOLLOW_DAMPING_MS = 36
const MAX_FOLLOW_SPEED_PX_PER_MS = 2
const INITIAL_PLACEMENT_STABLE_FRAMES = 2
const INITIAL_PLACEMENT_MAX_FRAMES = 8
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])
const SCROLL_DISCLOSURE_EVENT = 'dsh:scroll-disclosure'

/** Notify the scrollports before a reader changes the size of a disclosure. */
export function preserveDisclosurePosition(trigger: HTMLElement): void {
  trigger.dispatchEvent(new Event(SCROLL_DISCLOSURE_EVENT, { bubbles: true }))
}

interface ScheduledFollow {
  readonly cancel: () => void
}

interface ReaderGesture {
  readonly timeout: number
  readonly awaitingScroll: boolean
}

interface LayoutProtection {
  preserveTailUntil: number
  // Only a viewport resize extends immediate alignment, even while content grows.
  snapTailUntil: number
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
  /** Apply paging keys on the focused scrollport through the same position writer. */
  readonly keyboardNavigation?: boolean
  /** Only live log views follow growth automatically. */
  readonly autoFollow?: boolean
}

/** A reader position captured before a history prepend or layout change. */
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
  /** Capture the current position for a guarded restoration. */
  readonly captureScrollAnchor: (row?: HTMLElement) => ScrollAnchor | undefined
  /** Restore a captured position only while the reader is still there. */
  readonly restoreScrollAnchor: (anchor: ScrollAnchor, row?: HTMLElement) => boolean
  /** Whether a newer reader action has superseded a captured position. */
  readonly isScrollAnchorCurrent: (anchor: ScrollAnchor) => boolean
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

function keyboardOffset(element: HTMLDivElement, event: KeyboardEvent, tail: number): number {
  const top = element.scrollTop
  const page = Math.max(1, element.clientHeight)
  switch (event.key) {
    case 'Home':
      return 0
    case 'End':
      return tail
    case 'PageUp':
      return top - page
    case 'PageDown':
      return top + page
    case ' ':
      return top + (event.shiftKey ? -page : page)
    default: {
      const parsed = Number.parseFloat(window.getComputedStyle(element).lineHeight)
      const line = Number.isFinite(parsed) && parsed > 0 ? parsed : 40
      return top + (event.key === 'ArrowUp' ? -line : line)
    }
  }
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
  const readerGestureRef = useRef<ReaderGesture | undefined>(undefined)
  const interactionGenerationRef = useRef(0)
  const internalScrollTopRef = useRef<number | undefined>(undefined)
  const disclosurePositionRef = useRef<{ readonly generation: number; readonly top: number } | undefined>(
    undefined,
  )
  const lastReaderScrollTopRef = useRef<number | undefined>(undefined)
  const viewportHeightRef = useRef(0)
  const measuredTailRef = useRef<number | undefined>(undefined)
  const positionedSessionRef = useRef(false)
  const initialPlacementFrameRef = useRef<number | undefined>(undefined)
  const layoutProtectionRef = useRef<LayoutProtection>({ preserveTailUntil: 0, snapTailUntil: 0 })
  const smoothTailGrowth = options.smoothTailGrowth === true
  const autoFollow = options.autoFollow !== false
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
    const gesture = readerGestureRef.current
    if (gesture === undefined) return
    window.clearTimeout(gesture.timeout)
    readerGestureRef.current = undefined
  }, [])

  const clearLayoutProtection = useCallback((): void => {
    layoutProtectionRef.current = { preserveTailUntil: 0, snapTailUntil: 0 }
  }, [])

  const isUserScrollActive = useCallback(
    (): boolean =>
      readerGestureRef.current !== undefined &&
      disclosurePositionRef.current?.generation !== interactionGenerationRef.current,
    [],
  )

  const preserveTailDuringLayout = useCallback((): void => {
    layoutProtectionRef.current.preserveTailUntil = window.performance.now() + LAYOUT_SETTLE_MS
  }, [])

  const writeScrollTop = useCallback((element: HTMLDivElement, top: number, claimPosition = false): void => {
    const previous = element.scrollTop
    if (top !== previous) element.scrollTop = top
    // The browser can round or clamp the requested position during layout.
    const applied = element.scrollTop
    if (applied !== previous || claimPosition) internalScrollTopRef.current = applied
    lastReaderScrollTopRef.current = applied
  }, [])

  const restoreReaderPosition = useCallback(
    (reconcileLayout = false): void => {
      const element = scrollRef.current
      const savedScrollTop = lastReaderScrollTopRef.current
      if (element === null || savedScrollTop === undefined || stickToBottomRef.current) return

      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      const gesture = readerGestureRef.current
      // Leave new native offsets alone until their scroll event arrives. A
      // known layout transition may still briefly clamp an observed reader to zero.
      if (
        gesture !== undefined &&
        (!reconcileLayout || gesture.awaitingScroll || element.scrollTop > 1 || savedScrollTop <= 1)
      )
        return
      if (savedScrollTop > 1 && maxScrollTop <= 1) return
      writeScrollTop(element, Math.min(maxScrollTop, Math.max(0, savedScrollTop)))
    },
    [writeScrollTop],
  )

  const applyScrollAdjustment = useCallback(
    (delta: number): void => {
      if (!Number.isFinite(delta) || Math.abs(delta) <= 0.5) return
      const element = scrollRef.current
      if (element === null) return
      // The canvas resize reconciles the measured tail. Applying its adjustment
      // here would move the pinned viewport before the animation can start.
      if (smoothTailGrowth && stickToBottomRef.current && !isUserScrollActive()) return

      // If a virtualized canvas was briefly collapsed, the DOM can report zero
      // even though the reader was stably in the middle. Continue from the last
      // reader position so a measurement delta cannot turn that clamp into a
      // jump to the top. During an active gesture, the live DOM value wins.
      const savedScrollTop = lastReaderScrollTopRef.current
      const isCollapsedFreeReader =
        !stickToBottomRef.current &&
        !isUserScrollActive() &&
        element.scrollTop <= 1 &&
        savedScrollTop !== undefined &&
        savedScrollTop > 1
      const baseScrollTop = isCollapsedFreeReader ? (savedScrollTop ?? 0) : element.scrollTop
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      if (isCollapsedFreeReader && maxScrollTop <= 1) return
      writeScrollTop(element, Math.min(maxScrollTop, Math.max(0, baseScrollTop + delta)))
    },
    [isUserScrollActive, smoothTailGrowth, writeScrollTop],
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
    writeScrollTop(element, maxScrollTop, true)
    viewportHeightRef.current = element.clientHeight
    setShowJumpToLatest(false)
  }, [cancelScheduledFollow, cancelTailMotion, clearUserScrollLock, writeScrollTop])

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
      if (scrollRef.current !== element || !stickToBottomRef.current || isUserScrollActive()) return
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
  }, [isUserScrollActive, scrollToLatest, smoothTailGrowth])

  const followGrowth = useCallback((): void => {
    if (
      initialPlacementFrameRef.current !== undefined ||
      !smoothTailGrowth ||
      document.visibilityState === 'hidden' ||
      typeof window.requestAnimationFrame !== 'function' ||
      motionScale() === 0
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
      if (scrollRef.current !== element || !stickToBottomRef.current || isUserScrollActive()) {
        cancelTailMotion()
        return
      }
      const scale = motionScale()
      if (scale === 0) {
        scrollToLatest()
        return
      }
      const elapsed = Math.min(32, Math.max(0, timestamp - previousFrame)) / scale
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
      writeScrollTop(element, follow.position)
      if (follow.position < follow.target) follow.frame = window.requestAnimationFrame(tick)
      else tailMotionRef.current = undefined
    }
    viewportHeightRef.current = viewportHeight
    tailMotionRef.current = { frame: window.requestAnimationFrame(tick), target, position: scrollTop }
  }, [cancelTailMotion, isUserScrollActive, scrollToLatest, smoothTailGrowth, writeScrollTop])

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
      writeScrollTop(element, next, true)
      updateJumpVisibility()
    },
    [
      cancelInitialPlacement,
      cancelScheduledFollow,
      cancelTailMotion,
      clearLayoutProtection,
      clearUserScrollLock,
      updateJumpVisibility,
      writeScrollTop,
    ],
  )

  const scheduleScrollToLatest = useCallback(
    (scheduleOptions?: ScrollFollowScheduleOptions): void => {
      if (!autoFollow) return
      // A free reader may be clamped by a normal-flow/virtualized-canvas
      // transition. Restore the last observed reader position first; this
      // path never changes a free reader into tail-following mode.
      restoreReaderPosition(scheduleOptions?.preserveBottom === true)
      updateJumpVisibility()
      const preserveBottom =
        scheduleOptions?.preserveBottom === true &&
        stickToBottomRef.current &&
        !isUserScrollActive() &&
        itemCountRef.current > 0
      const reconcileTail = (): void => {
        if (
          scheduleOptions?.snap === true ||
          layoutProtectionRef.current.snapTailUntil > window.performance.now()
        )
          scrollToLatest()
        else followGrowth()
      }
      if (preserveBottom) preserveTailDuringLayout()
      if (preserveBottom && scheduleOptions?.immediate === true) {
        // Keep a resized viewport aligned before paint. Streaming content
        // returns to eased motion when the viewport has settled.
        cancelScheduledFollow()
        reconcileTail()
        return
      }
      const shouldFollow =
        stickToBottomRef.current || layoutProtectionRef.current.preserveTailUntil > window.performance.now()
      if (isUserScrollActive() || !shouldFollow || itemCountRef.current === 0) return
      // Reconcile the latest committed layout once per turn, without a timer
      // or frame wait. A captured reader gesture can still cancel this write.
      if (scheduledFrameRef.current !== undefined) return
      const scheduledGeneration = interactionGenerationRef.current

      const run = (): void => {
        scheduledFrameRef.current = undefined
        const preserveBottom = layoutProtectionRef.current.preserveTailUntil > window.performance.now()
        if (
          scheduledGeneration === interactionGenerationRef.current &&
          !isUserScrollActive() &&
          (stickToBottomRef.current || preserveBottom)
        ) {
          if (preserveBottom) {
            stickToBottomRef.current = true
            setIsPinnedToBottom(true)
          }
          reconcileTail()
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
      autoFollow,
      cancelScheduledFollow,
      followGrowth,
      isUserScrollActive,
      preserveTailDuringLayout,
      restoreReaderPosition,
      scrollToLatest,
      updateJumpVisibility,
    ],
  )

  const captureScrollAnchor = useCallback(
    (anchorRow?: HTMLElement): ScrollAnchor | undefined => {
      const element = scrollRef.current
      if (element === null) return undefined
      cancelInitialPlacement()
      cancelScheduledFollow()
      cancelTailMotion()
      clearLayoutProtection()
      // A new anchor supersedes older navigation and leaves tail-follow mode.
      interactionGenerationRef.current += 1
      stickToBottomRef.current = false
      setIsPinnedToBottom(false)
      updateJumpVisibility()
      lastReaderScrollTopRef.current = element.scrollTop
      const top = element.getBoundingClientRect().top
      const row =
        anchorRow ??
        Array.from(element.querySelectorAll<HTMLElement>('[data-node-id]')).find(
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
    },
    [
      cancelInitialPlacement,
      cancelScheduledFollow,
      cancelTailMotion,
      clearLayoutProtection,
      updateJumpVisibility,
    ],
  )

  const isScrollAnchorCurrent = useCallback(
    (anchor: ScrollAnchor): boolean => anchor.interactionGeneration === interactionGenerationRef.current,
    [],
  )

  const restoreScrollAnchor = useCallback(
    (anchor: ScrollAnchor, remappedRow?: HTMLElement): boolean => {
      const element = scrollRef.current
      if (element === null || !isScrollAnchorCurrent(anchor)) return false

      const row =
        remappedRow ??
        (anchor.nodeId === undefined
          ? undefined
          : Array.from(element.querySelectorAll<HTMLElement>('[data-node-id]')).find(
              (node) => node.dataset.nodeId === anchor.nodeId,
            ))
      const next =
        row !== undefined && anchor.nodeOffset !== undefined
          ? element.scrollTop +
            row.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            anchor.nodeOffset
          : anchor.scrollTop + element.scrollHeight - anchor.contentHeight
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      writeScrollTop(element, Math.min(maxScrollTop, Math.max(0, next)))
      return true
    },
    [isScrollAnchorCurrent, writeScrollTop],
  )

  const armUserScrollLock = useCallback(
    (awaitingScroll: boolean): void => {
      cancelScheduledFollow()
      cancelInitialPlacement()
      cancelTailMotion()
      clearLayoutProtection()
      internalScrollTopRef.current = undefined
      // A page can arrive between two events in the same wheel or scrollbar
      // gesture. New input supersedes its original reading anchor immediately.
      interactionGenerationRef.current += 1
      clearUserScrollLock()
      readerGestureRef.current = {
        awaitingScroll,
        timeout: window.setTimeout(() => {
          readerGestureRef.current = undefined
          if (stickToBottomRef.current && itemCountRef.current > 0) scheduleScrollToLatest()
        }, USER_SCROLL_IDLE_MS),
      }
    },
    [
      cancelInitialPlacement,
      cancelScheduledFollow,
      cancelTailMotion,
      clearLayoutProtection,
      clearUserScrollLock,
      scheduleScrollToLatest,
    ],
  )

  const handleScroll = useCallback((): void => {
    const element = scrollRef.current
    if (element === null) return
    const expectedScrollTop = internalScrollTopRef.current
    const disclosure = disclosurePositionRef.current
    if (disclosure?.generation === interactionGenerationRef.current) {
      const limit = Math.max(0, element.scrollHeight - element.clientHeight)
      if (Math.abs(element.scrollTop - Math.min(disclosure.top, limit)) <= 1) return
    }
    const isInternalScroll =
      expectedScrollTop !== undefined && Math.abs(element.scrollTop - expectedScrollTop) <= 1
    // The native event for our previous tail write may be delivered after a
    // newer render has grown the content. Its offset still belongs to us;
    // distance from the new tail must not turn it into a reader scroll-away.
    const userScrollActive = isUserScrollActive()
    const isInternalFollowScroll = isInternalScroll && stickToBottomRef.current && !userScrollActive
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
    const isViewportLayoutScroll = stickToBottomRef.current && viewportResized && !userScrollActive
    const scrollLimit = Math.max(0, element.scrollHeight - element.clientHeight)
    const distanceFromBottom = scrollLimit - element.scrollTop
    const tailResized =
      measuredTailRef.current !== undefined && Math.abs(scrollLimit - measuredTailRef.current) > 1
    const preserveTail = layoutProtectionRef.current.preserveTailUntil > window.performance.now()
    const isTailClamp =
      stickToBottomRef.current &&
      !userScrollActive &&
      expectedScrollTop !== undefined &&
      expectedScrollTop - element.scrollTop > 1 &&
      (distanceFromBottom <= 1 || (smoothTailGrowth && (tailResized || preserveTail)))
    if (isViewportLayoutScroll || isTailClamp) {
      if (!isInternalScroll) cancelTailMotion()
      internalScrollTopRef.current = element.scrollTop
      lastReaderScrollTopRef.current = element.scrollTop
    }
    const isLayoutScroll =
      !userScrollActive &&
      (isViewportLayoutScroll ||
        isTailClamp ||
        (preserveTail &&
          (element.scrollTop <= 1 ||
            (options.layoutMeasurementsActive === true && stickToBottomRef.current))))
    if (!isInternalScroll && !isLayoutScroll && element.scrollTop !== lastReaderScrollTopRef.current) {
      // Scroll events are the final source of truth. They also cover input
      // paths that do not reliably expose wheel/pointer intent in a Webview.
      // Refresh the lock for every physical scroll event. A pointer drag or
      // inertial trackpad sequence can last longer than one idle interval;
      // allowing the first timer to expire during that sequence hands control
      // back to the append follower while the reader is still moving.
      armUserScrollLock(false)
      lastReaderScrollTopRef.current = element.scrollTop
    }
    // During a native gesture, only an actual arrival at the tail can
    // re-enable append-follow. Using the relaxed reader threshold here would
    // turn a small intentional scroll-away into a delayed snap-back when the
    // gesture lock expires.
    const pinThreshold = isUserScrollActive() ? 1 : bottomThreshold
    const atLatest = isInternalScroll
      ? stickToBottomRef.current
      : isLayoutScroll || distanceFromBottom <= pinThreshold
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
    isUserScrollActive,
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
      armUserScrollLock(true)

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
    [armUserScrollLock, updateJumpVisibility],
  )

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    const nestedScrollConsumes = (target: EventTarget | null, deltaY?: number): boolean => {
      for (
        let node = target instanceof Element ? target : null;
        node !== null && node !== element;
        node = node.parentElement
      ) {
        const maxTop = node.scrollHeight - node.clientHeight
        if (maxTop <= 1) continue
        const style = getComputedStyle(node)
        if (!/^(auto|scroll)$/u.test(style.overflowY)) continue
        if (deltaY === undefined) return true
        const remaining = deltaY > 0 ? maxTop - node.scrollTop : node.scrollTop
        if (remaining > 1 || /^(contain|none)$/u.test(style.overscrollBehaviorY)) return true
      }
      return false
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.shiftKey) return
      const { deltaMode, deltaX, deltaY } = event
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return
      if (nestedScrollConsumes(event.target, deltaY)) return
      if (autoFollow && options.snapToTailOnWheel && event.cancelable && deltaY > 0) {
        let distance = deltaY
        if (deltaMode === 1) distance *= Number.parseFloat(getComputedStyle(element).lineHeight) || 16
        if (deltaMode === 2) distance *= element.clientHeight
        const maxTop = element.scrollHeight - element.clientHeight
        const gap = maxTop - element.scrollTop
        if (gap > 1 && gap <= distance + WHEEL_TAIL_DISTANCE) {
          // Reattach against the current layout before another chunk can move
          // the tail or the native wheel animation can leave a stale offset.
          event.preventDefault()
          userScrollToLatest()
          return
        }
      }
      handleWheel(event)
    }
    const onPointerDown = (event: PointerEvent): void => {
      // Scrollbar dragging and native middle-button autoscroll both begin
      // before the scroll event can distinguish reader input from layout.
      if ((event.button !== 0 && event.button !== 1) || nestedScrollConsumes(event.target)) return
      armUserScrollLock(true)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !SCROLL_KEYS.has(event.key) ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        nestedScrollConsumes(event.target)
      )
        return
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return
      if (options.keyboardNavigation !== true || event.target !== element || !event.cancelable) {
        armUserScrollLock(true)
        return
      }
      event.preventDefault()
      armUserScrollLock(false)
      const tail = Math.max(0, element.scrollHeight - element.clientHeight)
      const offset = Math.min(tail, Math.max(0, keyboardOffset(element, event, tail)))
      writeScrollTop(element, offset, true)
      const atLatest = tail - element.scrollTop <= 1
      stickToBottomRef.current = atLatest
      setIsPinnedToBottom(atLatest)
      updateJumpVisibility()
    }
    const onScrollEnd = (event: Event): void => {
      if (event.target !== element) return
      // An old or no-op scroll can end while input is still waiting for its
      // first native offset. Let that input keep ownership until it moves.
      if (readerGestureRef.current?.awaitingScroll !== false) return
      clearUserScrollLock()
      if (stickToBottomRef.current && itemCountRef.current > 0) scheduleScrollToLatest()
    }
    // Capture the gesture on the scroll owner itself, before React's delegated
    // listener and before the browser applies the native scroll offset.
    const onScroll = (event: Event): void => {
      if (event.target === element) scrollHandlerRef.current()
    }
    let disclosureFrame: number | undefined
    const cancelDisclosureFrame = (): void => {
      if (disclosureFrame !== undefined) window.cancelAnimationFrame(disclosureFrame)
      disclosureFrame = undefined
      disclosurePositionRef.current = undefined
    }
    const onDisclosure = (event: Event): void => {
      const trigger = event.target
      if (!(trigger instanceof HTMLElement) || element.clientHeight === 0) return
      const viewport = element.getBoundingClientRect()
      const header = trigger.getBoundingClientRect()
      if (header.bottom <= viewport.top || header.top >= viewport.bottom) return
      armUserScrollLock(false)
      stickToBottomRef.current = false
      lastReaderScrollTopRef.current = element.scrollTop
      setIsPinnedToBottom(false)
      updateJumpVisibility()

      cancelDisclosureFrame()
      if (typeof window.requestAnimationFrame !== 'function') {
        clearUserScrollLock()
        return
      }
      const offset = header.top - viewport.top
      const generation = interactionGenerationRef.current
      disclosurePositionRef.current = { generation, top: element.scrollTop }
      // The event bubbles from the innermost port out. Restore that port
      // first, then measure the same header from each containing port.
      disclosureFrame = window.requestAnimationFrame(() => {
        disclosureFrame = undefined
        disclosurePositionRef.current = undefined
        if (generation !== interactionGenerationRef.current) return
        clearUserScrollLock()
        if (!element.contains(trigger)) return
        const delta = trigger.getBoundingClientRect().top - element.getBoundingClientRect().top - offset
        const maxTop = Math.max(0, element.scrollHeight - element.clientHeight)
        if (Math.abs(delta) > 0.5)
          writeScrollTop(element, Math.min(maxTop, Math.max(0, element.scrollTop + delta)))
        updateJumpVisibility()
      })
    }
    element.addEventListener('wheel', onWheel, { capture: true, passive: !options.snapToTailOnWheel })
    element.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    element.addEventListener('keydown', onKeyDown, { capture: true })
    element.addEventListener('scroll', onScroll, { capture: true, passive: true })
    element.addEventListener('scrollend', onScrollEnd, { capture: true, passive: true })
    element.addEventListener(SCROLL_DISCLOSURE_EVENT, onDisclosure)
    return () => {
      cancelDisclosureFrame()
      element.removeEventListener(SCROLL_DISCLOSURE_EVENT, onDisclosure)
      element.removeEventListener('wheel', onWheel, true)
      element.removeEventListener('pointerdown', onPointerDown, true)
      element.removeEventListener('keydown', onKeyDown, true)
      element.removeEventListener('scroll', onScroll, true)
      element.removeEventListener('scrollend', onScrollEnd, true)
    }
  }, [
    armUserScrollLock,
    autoFollow,
    clearUserScrollLock,
    handleWheel,
    options.keyboardNavigation,
    options.snapToTailOnWheel,
    scheduleScrollToLatest,
    updateJumpVisibility,
    userScrollToLatest,
    writeScrollTop,
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
      cancelScheduledFollow()
      cancelTailMotion()
      clearLayoutProtection()
      clearUserScrollLock()
      interactionGenerationRef.current += 1
      internalScrollTopRef.current = undefined
      lastReaderScrollTopRef.current = undefined
      measuredTailRef.current = undefined
      previousSessionRef.current = options.sessionId
      positionedSessionRef.current = false
      stickToBottomRef.current = true
      setIsPinnedToBottom(true)
      setShowJumpToLatest(false)
    } else if (autoFollow) restoreReaderPosition(true)
    updateJumpVisibility()
    if (!autoFollow) {
      cancelInitialPlacement()
      cancelScheduledFollow()
      cancelTailMotion()
      return
    }
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
    autoFollow,
    cancelInitialPlacement,
    cancelScheduledFollow,
    cancelTailMotion,
    clearLayoutProtection,
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
    if (!autoFollow || element === null || typeof ResizeObserver === 'undefined') return

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
          if (measured && changed) {
            resized = true
            if (!isUserScrollActive() && stickToBottomRef.current)
              layoutProtectionRef.current.snapTailUntil = window.performance.now() + LAYOUT_SETTLE_MS
          }
          continue
        }
        if (entry.target !== content) continue
        const { height } = entry.contentRect
        const heightChanged =
          contentHeight === undefined ? smoothTailGrowth : Math.abs(height - contentHeight) >= 0.5
        if (heightChanged) resized = true
        contentHeight = height
      }
      if (resized && !isUserScrollActive()) scheduleScrollToLatest({ preserveBottom: true, immediate: true })
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
    autoFollow,
    cancelScheduledFollow,
    isUserScrollActive,
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
    isScrollAnchorCurrent,
    applyScrollAdjustment,
    isUserScrollActive,
    scheduleScrollToLatest,
    isPinnedToBottom,
    showJumpToLatest,
  }
}

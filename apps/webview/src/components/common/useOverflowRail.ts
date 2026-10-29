import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Whether a single-line horizontal rail actually overflows, so paging
 * affordances only take space when they do the job. The geometry is re-read on
 * scroll (the row can overflow by a single chip either way), on resize and
 * whenever the caller's item count changes — images and late-loaded labels can
 * settle after the first measurement.
 *
 * The ref is generic because a rail may be a `ul`, `ol` or `div`; only the
 * scroll geometry matters here.
 */
export function useOverflowRail<T extends HTMLElement = HTMLDivElement>(
  itemCount: number,
): { readonly railRef: RefObject<T | null>; readonly scrollable: boolean } {
  const railRef = useRef<T>(null)
  const [scrollable, setScrollable] = useState(false)
  useEffect(() => {
    const element = railRef.current
    if (element === null) return
    const update = (): void => setScrollable(element.scrollWidth > element.clientWidth + 1)
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [itemCount])
  return { railRef, scrollable }
}

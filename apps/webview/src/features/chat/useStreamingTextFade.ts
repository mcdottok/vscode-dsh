import { useLayoutEffect, useRef, type RefObject } from 'react'

// Each visible batch eases out on its own clock, even when the next batch arrives.
const FADE_DURATION_MS = 500
const INITIAL_TAIL_LENGTH = 160
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const FADE_STAGES = [
  { name: 'dsh-stream-fade-initial', until: 40 },
  { name: 'dsh-stream-fade-early', until: 100 },
  { name: 'dsh-stream-fade-mid', until: 170 },
  { name: 'dsh-stream-fade-late', until: 260 },
  { name: 'dsh-stream-fade-settle', until: 370 },
  { name: 'dsh-stream-fade-end', until: FADE_DURATION_MS },
]

interface FadeBatch {
  readonly start: number
  readonly end: number
  readonly arrivedAt: number
}

export function useStreamingTextFade(
  contentRef: RefObject<HTMLDivElement | null>,
  renderedTail: string,
  streaming: boolean,
  enabled: boolean,
): void {
  const previous = useRef<{ text: string; batches: readonly FadeBatch[] } | undefined>(undefined)

  useLayoutEffect(() => {
    if (!streaming && previous.current === undefined) return

    const registry = globalThis.CSS?.highlights
    if (
      !enabled ||
      registry === undefined ||
      typeof Highlight !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: no-preference) and (forced-colors: none)').matches ===
        false
    ) {
      previous.current = undefined
      return
    }

    let paragraph = contentRef.current?.lastElementChild ?? null
    while (
      paragraph?.matches('[data-dsh-markdown-tail], blockquote, ul, ol, li:has(> :last-child:is(p, ul, ol))')
    ) {
      paragraph = paragraph.lastElementChild
    }
    if (!paragraph?.matches('p, li')) {
      previous.current = undefined
      return
    }

    const text = paragraph.textContent ?? ''
    const prior = previous.current
    const now = performance.now()
    const append = prior !== undefined && text.startsWith(prior.text)
    const batches = append ? prior.batches.filter(({ arrivedAt }) => now - arrivedAt < FADE_DURATION_MS) : []
    let start = append ? prior.text.length : text.length
    if (streaming && prior === undefined) {
      // A reply can mount with its first packet already present. Bound the
      // initial fade for an in-progress reply that comes back into view.
      const tailStart = Math.max(0, text.length - INITIAL_TAIL_LENGTH)
      start = graphemes.segment(text).containing(tailStart)?.index ?? tailStart
    }
    if (start < text.length) batches.push({ start, end: text.length, arrivedAt: now })
    previous.current = streaming ? { text, batches } : undefined
    if (batches.length === 0) return

    // Streaming Markdown may replace the paragraph DOM. Remap the pending
    // ranges to the new text nodes without restarting their fade.
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const ranges: { readonly range: Range; readonly arrivedAt: number }[] = []
    let offset = 0
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0
      if (node.parentElement?.closest('a, code, .katex, [data-dsh-link]') === null) {
        for (const batch of batches) {
          const startInNode = Math.max(batch.start - offset, 0)
          const endInNode = Math.min(batch.end - offset, length)
          if (startInNode >= endInNode) continue
          const range = new Range()
          range.setStart(node, startInNode)
          range.setEnd(node, endInNode)
          ranges.push({ range, arrivedAt: batch.arrivedAt })
        }
      }
      offset += length
    }

    const active = new Map<Range, Highlight>()
    let frame: number | undefined
    const paint = (timestamp: number): void => {
      for (const { range, arrivedAt } of ranges) {
        const stage = FADE_STAGES.find(({ until }) => timestamp - arrivedAt < until)
        let highlight = stage === undefined ? undefined : registry.get(stage.name)
        if (stage !== undefined && highlight === undefined) {
          highlight = new Highlight()
          registry.set(stage.name, highlight)
        }
        const current = active.get(range)
        if (current === highlight) continue
        current?.delete(range)
        active.delete(range)
        if (highlight !== undefined) {
          highlight.add(range)
          active.set(range, highlight)
        }
      }
      frame = active.size > 0 ? window.requestAnimationFrame(paint) : undefined
    }
    paint(now)
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      for (const [range, highlight] of active) highlight.delete(range)
    }
  }, [contentRef, renderedTail, streaming, enabled])
}

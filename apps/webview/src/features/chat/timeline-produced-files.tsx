import { useEffect, type ReactElement } from 'react'
import type { Translate } from '../../i18n.js'
import { ContentFlow, useOverflowRail } from '../../components/common/index.js'
import { Icon } from '../../ui/Icon.js'
import type { ToolTimelineNode } from './ToolCallCollection.js'
import type { DisplayTimelineNode } from './timeline-shared.js'

export function renderDeliverables(
  node: Extract<DisplayTimelineNode, { readonly kind: 'deliverables' }>,
  onOpenLink: ((href: string) => void) | undefined,
  onShowInFolder: ((href: string) => void) | undefined,
  t: Translate,
): ReactElement {
  return (
    <section className="dsh-timeline__presented-card" aria-label={t('timeline.deliverables')}>
      <ul className="dsh-timeline__presented-files" data-presented-files-row="true">
        {node.files.map((file, index) => {
          const label = producedFileLabel(file.path)
          return (
            <li className="dsh-timeline__presented-file" key={`${file.path}:${index}`}>
              <span className="dsh-timeline__presented-file-badge" aria-hidden="true">
                <Icon name="file" />
              </span>
              <div className="dsh-timeline__presented-file-body">
                {onOpenLink === undefined ? (
                  <span className="dsh-timeline__presented-file-name" title={file.path}>
                    {label}
                  </span>
                ) : (
                  <button
                    className="dsh-timeline__presented-file-name"
                    type="button"
                    title={file.path}
                    aria-label={t('timeline.openPresented', { name: label })}
                    onClick={() => onOpenLink(file.path)}
                  >
                    {label}
                  </button>
                )}
                {file.description === undefined || file.description.trim() === '' ? null : (
                  <span className="dsh-timeline__presented-file-description">{file.description}</span>
                )}
              </div>
              {onShowInFolder === undefined ? null : (
                <button
                  className="dsh-timeline__presented-file-reveal"
                  type="button"
                  title={t('timeline.showInFolder')}
                  aria-label={t('timeline.revealPresented', { name: label })}
                  onClick={() => onShowInFolder(file.path)}
                >
                  <Icon name="folder" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function renderProducedFiles(
  paths: readonly string[],
  onOpenLink: ((href: string) => void) | undefined,
  t: Translate,
): ReactElement | null {
  if (paths.length === 0) return null
  return <ProducedFilesRow paths={paths} onOpenLink={onOpenLink} t={t} />
}

/**
 * One row of produced-file chips. The labels stay one line tall, so a row that
 * outgrows the card scrolls sideways instead of clipping: the paging buttons
 * appear only when the rail actually overflows, and a plain wheel over the row
 * travels sideways rather than dragging the conversation.
 */
function ProducedFilesRow({
  paths,
  onOpenLink,
  t,
}: {
  readonly paths: readonly string[]
  readonly onOpenLink: ((href: string) => void) | undefined
  readonly t: Translate
}): ReactElement {
  const { railRef, scrollable } = useOverflowRail<HTMLDivElement>(paths.length)
  const page = (direction: -1 | 1): void => {
    const element = railRef.current
    if (element === null) return
    const distance = Math.max(160, Math.floor(element.clientWidth * 0.8))
    element.scrollBy({ left: direction * distance, behavior: 'smooth' })
  }
  useEffect(() => {
    const element = railRef.current
    if (element === null) return
    // React's synthetic wheel listener is passive, so this one is native: the
    // conversation underneath must not scroll while the rail consumes the
    // gesture.
    const translate = (event: WheelEvent): void => {
      if (event.deltaX !== 0 || event.deltaY === 0) return
      if (element.scrollWidth <= element.clientWidth) return
      event.preventDefault()
      element.scrollLeft += event.deltaY
    }
    element.addEventListener('wheel', translate, { passive: false })
    return () => element.removeEventListener('wheel', translate)
  }, [railRef])
  return (
    <div
      className="dsh-timeline__produced-files"
      data-produced-files-row="true"
      aria-label={t('timeline.producedFiles')}
    >
      <span className="dsh-timeline__produced-label">{t('timeline.producedFiles')}</span>
      <div className="dsh-timeline__produced-rail">
        {scrollable ? (
          <button
            key="previous"
            className="dsh-timeline__produced-page"
            type="button"
            aria-label={t('timeline.producedFilesPrevious')}
            onClick={() => page(-1)}
          >
            <Icon name="chevron-left" />
          </button>
        ) : null}
        {/* Keyed so inserting the paging buttons never remounts the scroll
            element: a remount would reset its offset and its listeners. */}
        <div className="dsh-timeline__produced-list" key="list" ref={railRef}>
          {paths.map((path) => {
            const label = producedFileLabel(path)
            return onOpenLink === undefined ? (
              <span className="dsh-timeline__produced-chip" key={path} title={path}>
                <Icon name="file" />
                <ContentFlow as="span" variant="truncate">
                  {label}
                </ContentFlow>
              </span>
            ) : (
              <button
                className="dsh-timeline__produced-chip"
                key={path}
                type="button"
                title={path}
                aria-label={t('timeline.openProduced', { name: path })}
                onClick={() => onOpenLink(path)}
              >
                <Icon name="file" />
                <ContentFlow as="span" variant="truncate">
                  {label}
                </ContentFlow>
              </button>
            )
          })}
        </div>
        {scrollable ? (
          <button
            key="next"
            className="dsh-timeline__produced-page"
            type="button"
            aria-label={t('timeline.producedFilesNext')}
            onClick={() => page(1)}
          >
            <Icon name="chevron-right" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function producedFilePaths(tools: readonly ToolTimelineNode[]): readonly string[] {
  const cached = producedFilePathsCache.get(tools)
  if (cached !== undefined) return cached

  const paths: string[] = []
  const seen = new Set<string>()
  for (const node of tools) {
    const tool = node.tool
    if (tool.status !== 'completed' || !isMutationTool(tool)) continue
    for (const location of tool.locations ?? []) {
      if (seen.has(location.path)) continue
      seen.add(location.path)
      paths.push(location.path)
      if (paths.length >= 6) {
        producedFilePathsCache.set(tools, paths)
        return paths
      }
    }
  }
  const result = paths.length === 0 ? EMPTY_PRODUCED_FILE_PATHS : paths
  producedFilePathsCache.set(tools, result)
  return result
}

// Timeline snapshots are immutable, so the tool-array identity safely scopes
// this projection cache without retaining completed conversations forever.
const producedFilePathsCache = new WeakMap<readonly ToolTimelineNode[], readonly string[]>()
const EMPTY_PRODUCED_FILE_PATHS: readonly string[] = []

function isMutationTool(tool: ToolTimelineNode['tool']): boolean {
  const metadata = tool.metadata
  return (
    tool.category === 'diff' ||
    tool.category === 'edit' ||
    metadata.card === 'diff' ||
    metadata.kind === 'edit'
  )
}

export function producedFileLabel(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, '')
  const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return slash >= 0 && slash + 1 < normalized.length ? normalized.slice(slash + 1) : normalized
}

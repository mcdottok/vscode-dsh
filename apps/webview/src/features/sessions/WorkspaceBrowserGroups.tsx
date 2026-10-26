import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceSummary } from '@dsh-vscode/domain'
import type { AppStore } from '../../app/store.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'
import { MarkdownContent } from '../chat/MarkdownContent.js'
import { useDismissibleLayer } from '../../components/common/useDismissibleLayer.js'
import { useConversationLayout } from '../../app/ConversationLayoutProvider.js'

type Request = AppStore['workspaceBrowser']
type Project = { id: string; name: string; count: number; canOpen: boolean }
type Row = { id: string; title: string; archived: boolean }
type Message = { id: string; role: string; text: string }
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function items(value: unknown): Record<string, unknown>[] {
  const rows = record(value).items
  return Array.isArray(rows) ? rows.map(record) : []
}
export function WorkspaceBrowserGroups(props: {
  open: boolean
  request: Request
  workspaces: readonly WorkspaceSummary[]
  query: string
  archiveFilter: string
  renderHeader: (workspace: WorkspaceSummary) => ReactNode
  renderCurrent: (workspace: WorkspaceSummary) => ReactNode
}): ReactElement {
  const { t } = useI18n()
  const { open: browserOpen, request } = props
  const [projects, setProjects] = useState<Project[]>([])
  const [rows, setRows] = useState<Record<string, Row[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsedCurrent, setCollapsedCurrent] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<{ project: Project; session: Row }>()
  const epoch = useRef(0)
  const loading = useRef(new Set<string>())
  useEffect(() => {
    const version = ++epoch.current
    void Promise.resolve()
      .then(() => {
        if (version !== epoch.current) return undefined
        setPreview(undefined)
        setRows({})
        setProjects([])
        setExpanded(new Set())
        setCollapsedCurrent(new Set())
        setError(undefined)
        loading.current.clear()
        return browserOpen ? request('list') : undefined
      })
      .then((value) => {
        if (version !== epoch.current) return
        setProjects(
          items(value)
            .filter((row) => typeof row.id === 'string' && typeof row.name === 'string')
            .map((row) => ({
              id: String(row.id),
              name: String(row.name),
              count: typeof row.count === 'number' ? row.count : 0,
              canOpen: row.canOpen === true,
            })),
        )
      })
      .catch(() => {
        if (version === epoch.current) setError(t('sessions.browser.loadFailed'))
      })
    return () => {
      epoch.current = version + 1
    }
  }, [browserOpen, request, t])
  const others = useMemo(() => {
    const currentIds = new Set(props.workspaces.map((item) => item.id))
    return projects.filter((item) => !currentIds.has(item.id))
  }, [projects, props.workspaces])
  const load = useCallback(
    async (id: string): Promise<void> => {
      if (loading.current.has(id) || rows[id] !== undefined) return
      const version = epoch.current
      loading.current.add(id)
      setError(undefined)
      try {
        const value = await request('sessions', id)
        if (version !== epoch.current) return
        setRows((previous) => ({
          ...previous,
          [id]: items(value)
            .filter((row) => typeof row.id === 'string' && typeof row.title === 'string')
            .map((row) => ({
              id: String(row.id),
              title: String(row.title),
              archived: row.archived === true,
            })),
        }))
      } catch {
        if (version === epoch.current) setError(t('sessions.browser.loadFailed'))
      } finally {
        if (version === epoch.current) loading.current.delete(id)
      }
    },
    [request, rows, t],
  )
  useEffect(() => {
    if (!props.open || !props.query) return
    let cancelled = false
    // Search loads only directory rows, never transcripts or active sessions.
    void (async () => {
      for (const project of others) {
        if (cancelled) return
        await load(project.id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.open, props.query, others, load])
  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  return (
    <div className="dsh-workspace-browser">
      {props.workspaces.map((workspace) => (
        <section key={workspace.id} className="dsh-workspace-browser__group">
          <div className="dsh-workspace-browser__current-header">
            <button
              className="dsh-icon-button"
              type="button"
              aria-label={t('sessions.browser.toggle', { name: workspace.name })}
              aria-expanded={!collapsedCurrent.has(workspace.id)}
              onClick={() => setCollapsedCurrent((previous) => toggle(previous, workspace.id))}
            >
              <Icon name={collapsedCurrent.has(workspace.id) ? 'chevron-right' : 'chevron-down'} />
            </button>
            <div>{props.renderHeader(workspace)}</div>
            <small>{t('sessions.browser.current')}</small>
          </div>
          {collapsedCurrent.has(workspace.id) ? null : props.renderCurrent(workspace)}
        </section>
      ))}
      {others.length === 0 ? null : (
        <p className="dsh-workspace-browser__label">{t('sessions.browser.others')}</p>
      )}
      {others.map((project) => {
        const matches = rows[project.id]?.filter(
          (row) =>
            (props.archiveFilter === 'all' || row.archived === (props.archiveFilter === 'archived')) &&
            (!props.query ||
              project.name.toLowerCase().includes(props.query) ||
              row.title.toLowerCase().includes(props.query)),
        )
        if (props.query && matches?.length === 0 && !project.name.toLowerCase().includes(props.query))
          return null
        const open = expanded.has(project.id) || props.query !== ''
        return (
          <section key={project.id} className="dsh-workspace-browser__group">
            <button
              className="dsh-workspace-browser__heading"
              type="button"
              aria-expanded={open}
              onClick={() => {
                setExpanded((previous) => toggle(previous, project.id))
                if (!open) void load(project.id)
              }}
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} />
              <Icon name="folder" />
              <strong>{project.name}</strong>
              <small>{project.count}</small>
            </button>
            {!open ? null : (
              <div className="dsh-workspace-browser__sessions">
                {matches === undefined ? (
                  error ? (
                    <button
                      className="dsh-button dsh-button--ghost"
                      onClick={() => {
                        loading.current.delete(project.id)
                        void load(project.id)
                      }}
                    >
                      {t('runtime.retry')}
                    </button>
                  ) : (
                    <p role="status">{t('sessions.browser.loading')}</p>
                  )
                ) : matches.length === 0 ? (
                  <p>{t('sessions.empty')}</p>
                ) : (
                  matches.map((session) => (
                    <button
                      className="dsh-workspace-browser__row"
                      key={session.id}
                      type="button"
                      onClick={() => setPreview({ project, session })}
                    >
                      <Icon name="clock" />
                      <span>{session.title}</span>
                      <small>{t('sessions.browser.preview')}</small>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>
        )
      })}
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <ProjectPreview
          key={`${preview.project.id}/${preview.session.id}`}
          project={preview.project}
          session={preview.session}
          request={props.request}
          onClose={() => setPreview(undefined)}
        />
      ) : null}
    </div>
  )
}
function ProjectPreview({
  project,
  session,
  request,
  onClose,
}: {
  project: Project
  session: Row
  request: Request
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const conversationLayout = useConversationLayout()?.layout ?? 'focused'
  const panel = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const anchor = useRef<{ height: number; top: number } | 'latest'>('latest')
  const [messages, setMessages] = useState<Message[]>([])
  const [before, setBefore] = useState<number>()
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useDismissibleLayer({ open: true, refs: [panel], onDismiss: onClose, onEscape: onClose, trapFocus: true })
  const read = useCallback(
    async (cursor?: number): Promise<void> => {
      if (!alive.current) return
      const older = cursor !== undefined
      setBusy(true)
      setError(undefined)
      try {
        const result = record(await request('preview', project.id, session.id, cursor))
        if (!alive.current) return
        const next = items(result)
          .filter(
            (item) =>
              typeof item.id === 'string' &&
              typeof item.text === 'string' &&
              (item.role === 'user' || item.role === 'assistant'),
          )
          .map((item) => ({ id: String(item.id), role: String(item.role), text: String(item.text) }))
        anchor.current =
          older && scroll.current
            ? { height: scroll.current.scrollHeight, top: scroll.current.scrollTop }
            : 'latest'
        setMessages((previous) =>
          older ? [...next, ...previous.filter((item) => !next.some((row) => row.id === item.id))] : next,
        )
        setBefore(typeof result.beforeSequence === 'number' ? result.beforeSequence : undefined)
        setMore(result.hasMore === true && typeof result.beforeSequence === 'number')
      } catch {
        if (alive.current) setError(t('sessions.browser.loadFailed'))
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [request, project.id, session.id, t],
  )
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    element.scrollTop =
      anchor.current === 'latest'
        ? element.scrollHeight
        : anchor.current.top + element.scrollHeight - anchor.current.height
  }, [messages])
  useEffect(() => {
    alive.current = true
    void Promise.resolve().then(() => read())
    return () => {
      alive.current = false
    }
  }, [read])
  return createPortal(
    <div className="dsh-project-preview__backdrop">
      <div
        ref={panel}
        className="dsh-project-preview"
        role="dialog"
        aria-modal="true"
        aria-label={session.title}
        tabIndex={-1}
      >
        <header>
          <div>
            <strong>{session.title}</strong>
            <small>
              {project.name} · {t('sessions.browser.readonly')}
            </small>
          </div>
          <button className="dsh-icon-button" aria-label={t('sessions.browser.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <p className="dsh-project-preview__notice">{t('sessions.browser.readonlyHint')}</p>
        <div
          ref={scroll}
          className="dsh-project-preview__messages dsh-timeline"
          data-conversation-layout={conversationLayout}
          aria-busy={busy}
        >
          {more ? (
            <button
              className="dsh-button"
              disabled={busy}
              onClick={() => {
                void read(before)
              }}
            >
              {t('sessions.browser.older')}
            </button>
          ) : null}
          <div className="dsh-timeline__canvas">
            {messages.map((message) => (
              <div className="dsh-timeline__row" key={message.id}>
                <div
                  className={`dsh-timeline__message-stack${message.role === 'user' ? ' dsh-timeline__message-stack--user' : ''}`}
                >
                  <article
                    className={`dsh-timeline__card dsh-timeline__card--${message.role}`}
                    data-role={message.role}
                    aria-label={t(
                      message.role === 'user' ? 'timeline.yourMessage' : 'sessions.browser.assistant',
                    )}
                  >
                    <MarkdownContent markdown={message.text} onOpenLink={() => undefined} />
                  </article>
                </div>
              </div>
            ))}
          </div>
          {busy ? <p role="status">{t('sessions.browser.loading')}</p> : null}
          {error ? (
            <p role="alert">
              {error}{' '}
              <button
                onClick={() => {
                  void read()
                }}
              >
                {t('runtime.retry')}
              </button>
            </p>
          ) : null}
          {!busy && !error && messages.length === 0 ? <p>{t('sessions.browser.noText')}</p> : null}
        </div>
        <footer>
          <button
            className="dsh-button"
            disabled={!project.canOpen || busy || session.archived}
            onClick={() => {
              setBusy(true)
              setError(undefined)
              void request('open', project.id, session.id)
                .then(onClose)
                .catch(() => {
                  if (alive.current) setError(t('sessions.browser.openFailed'))
                })
                .finally(() => {
                  if (alive.current) setBusy(false)
                })
            }}
          >
            {t('sessions.browser.continue')}
          </button>
          {session.archived ? (
            <small>{t('sessions.browser.archivedHint')}</small>
          ) : project.canOpen ? null : (
            <small>{t('sessions.browser.remote')}</small>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}

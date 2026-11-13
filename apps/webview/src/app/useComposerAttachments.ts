import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ImageAttachmentLimits,
  EditorContextItem,
  PromptAttachment,
  SessionSummary,
  SubagentCatalog,
} from '@dsh-vscode/domain'
import type { AppStore, OpenFileCandidate, ReferenceCandidate } from './store.js'
import { readDraft, selectDraftKey, sessionDraftKey, setDraft } from './draft-store.js'
import { publicProtocolErrorCode, publicProtocolErrorMessage } from './protocol-client.js'
import { useStableCallback } from './useStableCallback.js'
import { readFileAsBase64, formatByteSize } from './attachment-reader.js'
import {
  attachmentDraftKey,
  browserFileOrigin,
  type AttachmentDraftOrigin,
} from '../features/composer/attachmentDrafts.js'
import type { Translate } from '../i18n.js'

const EMPTY_OPEN_FILE_CANDIDATES: readonly OpenFileCandidate[] = []
const EMPTY_REFERENCE_CANDIDATES: readonly ReferenceCandidate[] = []

/**
 * The composer draft and its attachments: pasted or picked files, the open-file
 * picker snapshot, `@` reference candidates, and the previews the Host renders
 * for image handles. Everything here is client-owned scratch state that the
 * Host only ever sees through an attachment handle, so it lives apart from the
 * conversation projection.
 */
export interface ComposerAttachmentDependencies {
  readonly store: AppStore
  readonly t: Translate
  readonly setError: (message: string | undefined) => void
  /**
   * Submission outcomes belong above the input rather than in the timed
   * toolbar toast: the draft is still visible there, and a Session held by
   * another instance stays blocked until the user acts elsewhere.
   */
  readonly setSubmitError: (message: string | undefined) => void
  readonly active: SessionSummary | undefined
  readonly activeSessionId: string | undefined
  readonly imageLimits: ImageAttachmentLimits | undefined
  readonly hasPendingSession: boolean
  readonly subagentEntries: SubagentCatalog['entries']
  readonly editorContext: readonly EditorContextItem[]
  readonly mountedRef: { readonly current: boolean }
}

export interface ComposerAttachments {
  readonly attachments: readonly PromptAttachment[]
  readonly attachmentPreviews: Readonly<Record<string, string>>
  readonly attachmentPreviewFailures: readonly string[]
  readonly visibleOpenFileCandidates: readonly OpenFileCandidate[]
  readonly visibleOpenFilePickerOpen: boolean
  readonly visibleOpenFilePickerLoading: boolean
  readonly attachedOpenFileIds: readonly string[]
  readonly attachingOpenFileId: string | undefined
  readonly visibleReferenceCandidates: readonly ReferenceCandidate[]
  readonly visibleReferenceLoading: boolean
  readonly awaitingFirstPrompt: boolean
  readonly discardAttachmentDrafts: () => void
  readonly removeAttachmentDrafts: (uris: readonly string[], release: boolean) => void
  readonly composerOnReferenceQueryChange: (query: string | undefined, quoted: boolean) => void
  readonly composerOnPickAttachment: () => void
  readonly composerOnIngestFiles: (files: readonly File[]) => void
  readonly composerOnToggleOpenFilePicker: () => void
  readonly composerOnExtrasOpenChange: (open: boolean) => void
  readonly composerOnSelectOpenFile: (candidateId: string) => void
  readonly composerOnRemoveAttachment: (uri: string) => void
  readonly composerOnSubmit: (mode: 'queue' | 'steer', signal?: AbortSignal) => Promise<void>
}

function contextOpenFileIds(items: readonly EditorContextItem[]): string[] {
  return items.flatMap((item) =>
    item.ref.kind === 'file' && item.ref.sourceCandidateId !== undefined ? [item.ref.sourceCandidateId] : [],
  )
}

export function useComposerAttachments(deps: ComposerAttachmentDependencies): ComposerAttachments {
  const {
    store,
    t,
    setError,
    setSubmitError,
    active,
    activeSessionId,
    imageLimits,
    hasPendingSession,
    subagentEntries,
  } = deps
  const mountedRef = deps.mountedRef
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [firstPromptHandoff, setFirstPromptHandoff] = useState<{ readonly sessionId: string }>()
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  const [attachmentPreviewFailures, setAttachmentPreviewFailures] = useState<readonly string[]>([])
  const [openFileCandidates, setOpenFileCandidates] = useState<readonly OpenFileCandidate[]>([])
  const [openFileCandidatesSessionId, setOpenFileCandidatesSessionId] = useState<string | undefined>()
  const [openFilePickerOpen, setOpenFilePickerOpen] = useState(false)
  const [openFilePickerSessionId, setOpenFilePickerSessionId] = useState<string | undefined>()
  const [openFilePickerLoading, setOpenFilePickerLoading] = useState(false)
  const [referenceCandidates, setReferenceCandidates] = useState<readonly ReferenceCandidate[]>([])
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceSessionId, setReferenceSessionId] = useState<string | undefined>()
  const [referenceQuery, setReferenceQuery] = useState('')
  const [referenceQuoted, setReferenceQuoted] = useState(false)
  const [attachingOpenFileId, setAttachingOpenFileId] = useState<string | undefined>()
  const [openFileAttachmentIds, setOpenFileAttachmentIds] = useState<Record<string, string>>({})
  const attachmentDraftKeysRef = useRef<Map<string, string>>(new Map())
  /** Decoded bytes of pasted image drafts still tracked in the composer, by uri. */
  const imageBytesByUriRef = useRef<Map<string, number>>(new Map())
  /** Image count/bytes of pastes whose read or ingest has not settled yet. */
  const pendingImageStatsRef = useRef<{ count: number; bytes: number }>({ count: 0, bytes: 0 })
  const attachingOpenFileRef = useRef<string | undefined>(undefined)
  const referenceRequestRef = useRef(0)
  const openFileRequestRef = useRef(0)
  const openFilePickerRequestRef = useRef(0)
  const attachmentGenerationRef = useRef(0)
  const admissionWaitsRef = useRef(new Set<() => void>())

  useEffect(() => {
    const waits = admissionWaitsRef.current
    return () => {
      for (const cancel of waits) cancel()
    }
  }, [])

  useEffect(() => {
    const missing = attachments.filter(
      (attachment) =>
        attachment.mimeType?.startsWith('image/') === true &&
        attachmentPreviews[attachment.uri] === undefined &&
        !attachmentPreviewFailures.includes(attachment.uri),
    )
    if (missing.length === 0) return
    let cancelled = false
    const recordFailure = (uri: string): void => {
      setAttachmentPreviewFailures((current) => (current.includes(uri) ? current : [...current, uri]))
    }
    for (const attachment of missing) {
      void store
        .previewAttachment(attachment.uri)
        .then((dataUri) => {
          if (cancelled) return
          // `undefined` is the Host's flattened refusal (an expired or dead
          // draft handle); recording it keeps the lightbox from claiming the
          // image is merely still loading.
          if (dataUri === undefined) recordFailure(attachment.uri)
          else setAttachmentPreviews((current) => ({ ...current, [attachment.uri]: dataUri }))
        })
        .catch(() => {
          if (!cancelled) recordFailure(attachment.uri)
        })
    }
    return () => {
      cancelled = true
    }
  }, [attachments, attachmentPreviewFailures, attachmentPreviews, store])

  const visibleOpenFilePickerOpen =
    openFilePickerOpen && openFilePickerSessionId !== undefined && openFilePickerSessionId === activeSessionId
  const visibleOpenFileCandidates = useMemo(
    () => (openFileCandidatesSessionId === activeSessionId ? openFileCandidates : EMPTY_OPEN_FILE_CANDIDATES),
    [activeSessionId, openFileCandidates, openFileCandidatesSessionId],
  )
  const visibleOpenFilePickerLoading =
    openFilePickerLoading &&
    openFilePickerSessionId !== undefined &&
    openFilePickerSessionId === activeSessionId
  const attachedOpenFileIds = useMemo(
    // Domain editor context refs are data handles, not React refs.
    // eslint-disable-next-line react-hooks/refs
    () => [...Object.values(openFileAttachmentIds), ...contextOpenFileIds(deps.editorContext)],
    [deps.editorContext, openFileAttachmentIds],
  )
  const updateReferenceQuery = (query: string | undefined, quoted: boolean): void => {
    const sessionId = active?.id
    const request = ++referenceRequestRef.current
    if (sessionId === undefined || query === undefined) {
      setReferenceCandidates([])
      setReferenceLoading(false)
      setReferenceSessionId(undefined)
      setReferenceQuery('')
      setReferenceQuoted(false)
      return
    }
    setReferenceSessionId(sessionId)
    setReferenceQuery(query)
    setReferenceQuoted(quoted)
    setReferenceLoading(true)
    void store
      .listReferences(sessionId, query, quoted)
      .then((candidates) => {
        if (request === referenceRequestRef.current && store.getState().activeSessionId === sessionId)
          setReferenceCandidates(candidates)
      })
      .catch(() => {
        if (request === referenceRequestRef.current && store.getState().activeSessionId === sessionId)
          setReferenceCandidates([])
      })
      .finally(() => {
        if (request === referenceRequestRef.current && store.getState().activeSessionId === sessionId)
          setReferenceLoading(false)
      })
  }
  const localSubagentReferences = useMemo<readonly ReferenceCandidate[]>(() => {
    if (referenceQuoted || activeSessionId === undefined) return EMPTY_REFERENCE_CANDIDATES
    const needle = referenceQuery.trim().toLocaleLowerCase()
    const candidates: ReferenceCandidate[] = []
    for (const entry of subagentEntries) {
      if (entry.kind !== 'child') continue
      const label = entry.label?.trim() || t('subagents.unnamed')
      if (!label.toLocaleLowerCase().includes(needle)) continue
      candidates.push({
        id: `subagent:${entry.id}`,
        kind: 'session',
        sessionId: entry.id,
        label,
        description: t('composer.referenceSubagent'),
        mention: `@[${label}](dsh-session:${entry.id})`,
      })
    }
    return candidates
  }, [activeSessionId, referenceQuery, referenceQuoted, subagentEntries, t])
  const visibleReferenceCandidates = useMemo(() => {
    if (referenceSessionId !== activeSessionId) return EMPTY_REFERENCE_CANDIDATES
    if (referenceCandidates.length === 0) return localSubagentReferences
    if (localSubagentReferences.length === 0) return referenceCandidates
    return [...referenceCandidates, ...localSubagentReferences]
  }, [activeSessionId, localSubagentReferences, referenceCandidates, referenceSessionId])
  const visibleReferenceLoading = referenceSessionId === active?.id && referenceLoading
  const appendAttachment = (
    attachment: PromptAttachment,
    openFileId?: string,
    generation = attachmentGenerationRef.current,
    origin?: AttachmentDraftOrigin,
  ): void => {
    if (generation !== attachmentGenerationRef.current) {
      void store.releaseAttachments([attachment.uri]).catch(() => undefined)
      return
    }
    if (attachmentDraftKeysRef.current.has(attachment.uri)) return
    const draftKey = attachmentDraftKey(attachment, origin)
    const existingUri = [...attachmentDraftKeysRef.current.entries()].find(([, key]) => key === draftKey)?.[0]
    if (existingUri !== undefined) {
      if (existingUri !== attachment.uri)
        void store
          .releaseAttachments([attachment.uri])
          .catch((reason: unknown) =>
            setError(reason instanceof Error ? reason.message : t('app.error.releaseAttachment')),
          )
      return
    }
    attachmentDraftKeysRef.current.set(attachment.uri, draftKey)
    setAttachments((current) =>
      current.some((item) => item.uri === attachment.uri) ? current : [...current, attachment],
    )
    if (openFileId !== undefined)
      setOpenFileAttachmentIds((current) => ({ ...current, [attachment.uri]: openFileId }))
  }
  const removeAttachmentDrafts = (uris: readonly string[], release: boolean): void => {
    if (uris.length === 0) return
    const removed = new Set(uris)
    for (const uri of removed) {
      attachmentDraftKeysRef.current.delete(uri)
      imageBytesByUriRef.current.delete(uri)
    }
    setAttachments((current) => current.filter((attachment) => !removed.has(attachment.uri)))
    setAttachmentPreviews((current) =>
      Object.fromEntries(Object.entries(current).filter(([uri]) => !removed.has(uri))),
    )
    setAttachmentPreviewFailures((current) => current.filter((uri) => !removed.has(uri)))
    setOpenFileAttachmentIds((current) =>
      Object.fromEntries(Object.entries(current).filter(([uri]) => !removed.has(uri))),
    )
    if (release)
      void store
        .releaseAttachments(uris)
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : t('app.error.releaseAttachment')),
        )
  }
  const discardAttachmentDrafts = useStableCallback((): void => {
    attachmentGenerationRef.current += 1
    removeAttachmentDrafts(
      attachments.map((attachment) => attachment.uri),
      true,
    )
    setOpenFilePickerOpen(false)
  })
  const ingestFiles = (files: readonly File[]): void => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (imageLimits !== undefined && imageFiles.length > 0) {
      const existingImages = attachments.filter((attachment) =>
        attachment.mimeType?.startsWith('image/'),
      ).length
      const existingImageBytes = [...imageBytesByUriRef.current.values()].reduce(
        (sum, bytes) => sum + bytes,
        0,
      )
      const pendingImages = pendingImageStatsRef.current
      // Checks run before any read starts, so a batch can never push the
      // composer past what DSH will admit for the message.
      if (existingImages + pendingImages.count + imageFiles.length > imageLimits.maxImagesPerMessage) {
        setError(t('app.error.imageCount', { count: imageLimits.maxImagesPerMessage }))
        return
      }
      const batchImageBytes = imageFiles.reduce((sum, file) => sum + file.size, 0)
      if (existingImageBytes + pendingImages.bytes + batchImageBytes > imageLimits.maxMessageImageBytes) {
        setError(t('app.error.imageTotalSize', { size: formatByteSize(imageLimits.maxMessageImageBytes) }))
        return
      }
      const unsupported = imageFiles.find((file) => !imageLimits.mediaTypes.includes(file.type))
      if (unsupported !== undefined) {
        setError(t('app.error.imageType', { name: unsupported.name }))
        return
      }
      const oversized = imageFiles.find((file) => file.size > imageLimits.maxImageBytes)
      if (oversized !== undefined) {
        setError(
          t('app.error.imageTooLarge', {
            name: oversized.name,
            size: formatByteSize(imageLimits.maxImageBytes),
          }),
        )
        return
      }
    }
    const generation = attachmentGenerationRef.current
    for (const file of files) {
      const origin = browserFileOrigin(file)
      const isImage = file.type.startsWith('image/')
      if (isImage) {
        pendingImageStatsRef.current.count += 1
        pendingImageStatsRef.current.bytes += file.size
      }
      void readFileAsBase64(file, t, imageLimits)
        .then((payload) => store.ingestAttachment(payload))
        .then((attachment) => {
          if (attachment === undefined) return
          appendAttachment(attachment, undefined, generation, origin)
          // Only a draft actually tracked by appendAttachment contributes bytes:
          // duplicates resolve to the earlier uri and released handles never do.
          if (
            isImage &&
            attachmentDraftKeysRef.current.has(attachment.uri) &&
            !imageBytesByUriRef.current.has(attachment.uri)
          )
            imageBytesByUriRef.current.set(attachment.uri, file.size)
        })
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : t('app.error.attachPasted')),
        )
        .finally(() => {
          if (isImage) {
            pendingImageStatsRef.current.count -= 1
            pendingImageStatsRef.current.bytes -= file.size
          }
        })
    }
  }
  const submitPrompt = (mode: 'queue' | 'steer', signal?: AbortSignal): Promise<void> => {
    if (active === undefined && !hasPendingSession) return Promise.resolve()
    // A retry starts from a clean slate; the previous rejection is stale now.
    setSubmitError(undefined)
    const before = store.getState()
    const draftKey = selectDraftKey(before)
    const text = readDraft(draftKey)
    const attachmentSnapshot = attachments
    const pending = active === undefined ? before.pendingSession : undefined
    let handoff: { readonly sessionId: string } | undefined
    const submittedDraftKey = (): string | undefined =>
      handoff === undefined || store.getState().pendingSession?.revision === pending?.revision
        ? draftKey
        : sessionDraftKey(handoff.sessionId)
    const clearSubmittedDraft = (): void =>
      setDraft(submittedDraftKey(), (current) => (current === text ? '' : current))
    let stopHandoffWatch: (() => void) | undefined
    const rememberFirstPromptSession = (): void => {
      const current = store.getState().pendingSession
      if (
        handoff !== undefined ||
        !mountedRef.current ||
        current?.revision !== pending?.revision ||
        current?.createdSessionId === undefined
      )
        return
      handoff = { sessionId: current.createdSessionId }
      setFirstPromptHandoff(handoff)
      stopHandoffWatch?.()
      stopHandoffWatch = undefined
    }
    // Opening the real session clears pendingSession. Observe its assigned ID
    // before then, and keep the handoff through the existing delivery wait.
    if (pending !== undefined) {
      stopHandoffWatch = store.subscribe(rememberFirstPromptSession)
      rememberFirstPromptSession()
    }
    const beforeIds = new Set(before.timeline.nodes.map((node) => node.id))
    const beforeRequests = new Set(before.directPromptRequestIds)
    let submission: Promise<void>
    try {
      submission =
        active === undefined
          ? store.sendPendingPrompt(text, attachmentSnapshot, mode, signal)
          : store.sendPrompt(active.id, text, attachmentSnapshot, mode, signal)
    } catch (reason) {
      submission = Promise.reject(reason instanceof Error ? reason : new Error(t('app.error.prompt')))
    }
    // A durable message can reach the timeline before the RPC response. Its
    // exact request identity proves delivery, so don't leave the same message
    // in the composer while the Host is still finishing the response. Capture
    // only an identity registered synchronously by this send; slash-command and
    // new-session setup may register later and retain their existing path.
    const directAtDispatch = (store.getState().directPromptRequestIds ?? []).filter(
      (id) => !beforeRequests.has(id),
    )
    const directRequest =
      active !== undefined && directAtDispatch.length === 1 ? directAtDispatch[0] : undefined
    let stopEarlyWatch = (): void => undefined
    const earlyDelivery =
      directRequest === undefined || active === undefined
        ? undefined
        : new Promise<'visible' | 'cancelled'>((resolve) => {
            let unsubscribe = (): void => undefined
            let settled = false
            const finish = (result: 'visible' | 'cancelled'): void => {
              if (settled) return
              settled = true
              unsubscribe()
              admissionWaitsRef.current.delete(cancelled)
              signal?.removeEventListener('abort', cancelled)
              resolve(result)
            }
            const cancelled = (): void => finish('cancelled')
            const check = (): void => {
              const current = store.getState()
              if (
                !mountedRef.current ||
                signal?.aborted === true ||
                current.activeSessionId !== active.id ||
                current.backend.kind !== 'connected'
              ) {
                cancelled()
                return
              }
              if (
                current.timeline.sessionId === active.id &&
                current.timeline.nodes.some(
                  (node) =>
                    node.kind === 'user-message' && !beforeIds.has(node.id) && node.rpcId === directRequest,
                )
              )
                finish('visible')
            }
            stopEarlyWatch = cancelled
            unsubscribe = store.subscribe(check)
            admissionWaitsRef.current.add(cancelled)
            signal?.addEventListener('abort', cancelled, { once: true })
            check()
          })
    const receipt = submission.then(() => 'receipt' as const)
    return (async () => {
      let outcome: 'receipt' | 'visible' | 'cancelled'
      try {
        outcome = await (earlyDelivery === undefined ? receipt : Promise.race([receipt, earlyDelivery]))
      } finally {
        stopEarlyWatch()
      }
      if (outcome === 'cancelled') outcome = await receipt
      if (outcome === 'visible') {
        if (
          !mountedRef.current ||
          Boolean(signal?.aborted) ||
          store.getState().activeSessionId !== active?.id
        )
          return
        clearSubmittedDraft()
        // Delivery already consumed the snapshot. Release its handles even if
        // the late RPC response fails; the Host release is idempotent.
        removeAttachmentDrafts(
          attachmentSnapshot.map((attachment) => attachment.uri),
          true,
        )
        const contextRefs = before.editorContext.map((item) => item.ref.contextRef)
        if (contextRefs.length > 0) void store.releaseEditorContext(contextRefs).catch(() => undefined)
        setOpenFilePickerOpen(false)
        return
      }
      if (!mountedRef.current || Boolean(signal?.aborted)) return
      const admitted = store.getState()
      // The Host has accepted the prompt. Some runtimes omit the request ID
      // or transform the displayed text, so timeline matching is only useful
      // before this receipt, when an exact ID can confirm earlier delivery.
      clearSubmittedDraft()
      if (selectDraftKey(admitted) !== submittedDraftKey()) return
      // The Extension Host consumes only the handles admitted by this send;
      // keep any draft attachments the user added while it was in flight.
      removeAttachmentDrafts(
        attachmentSnapshot.map((attachment) => attachment.uri),
        false,
      )
      setOpenFilePickerOpen(false)
    })()
      .catch((reason: unknown) => {
        if (Boolean(signal?.aborted) || (reason instanceof DOMException && reason.name === 'AbortError'))
          return
        if (!mountedRef.current || selectDraftKey(store.getState()) !== submittedDraftKey()) return
        // One Session has one writer across DSH instances. Name that condition
        // instead of forwarding the Host's generic busy text, and keep the
        // slower hint on every other failure: the user otherwise only sees a
        // draft that will not leave the composer.
        if (publicProtocolErrorCode(reason) === 'SESSION_WRITER_HELD')
          setSubmitError(t('app.error.sessionWriterHeld'))
        else
          setSubmitError(
            `${publicProtocolErrorMessage(reason) ?? t('app.error.prompt')} ${t('app.error.promptOccupiedHint')}`,
          )
      })
      .finally(() => {
        stopHandoffWatch?.()
        if (handoff !== undefined && mountedRef.current)
          setFirstPromptHandoff((current) => (current === handoff ? undefined : current))
      })
  }
  /**
   * Loads the open-file snapshot that both the composer menu row and the
   * picker render. The row is only offered when the list names an attachable
   * file, so it has to be requested while that menu is being built.
   */
  const loadOpenFileCandidates = (sessionId: string, awaitingPicker: boolean): void => {
    const request = ++openFileRequestRef.current
    if (awaitingPicker) {
      openFilePickerRequestRef.current = request
      setOpenFilePickerLoading(true)
    }
    void store
      .listOpenFiles()
      .then((candidates) => {
        if (request !== openFileRequestRef.current) return
        setOpenFileCandidatesSessionId(sessionId)
        setOpenFileCandidates(candidates)
      })
      .catch((reason: unknown) => {
        if (request !== openFileRequestRef.current) return
        setOpenFileCandidatesSessionId(sessionId)
        setOpenFileCandidates([])
        if (awaitingPicker) setError(reason instanceof Error ? reason.message : t('app.error.listOpenFiles'))
      })
      .finally(() => {
        // Only the newest picker-awaiting request may clear the flag: a fast
        // close and reopen leaves the older request settling last, and clearing
        // unconditionally would end the newer request's loading state. Requests
        // that do not await the picker never touch the flag.
        if (awaitingPicker && request === openFilePickerRequestRef.current) setOpenFilePickerLoading(false)
      })
  }
  const toggleOpenFilePicker = (): void => {
    if (visibleOpenFilePickerOpen) {
      setOpenFilePickerOpen(false)
      return
    }
    if (activeSessionId === undefined) return
    setOpenFilePickerSessionId(activeSessionId)
    setOpenFilePickerOpen(true)
    loadOpenFileCandidates(activeSessionId, true)
  }
  const selectOpenFile = (candidateId: string): void => {
    if (
      attachingOpenFileRef.current !== undefined ||
      attachingOpenFileId !== undefined ||
      attachedOpenFileIds.includes(candidateId)
    )
      return
    attachingOpenFileRef.current = candidateId
    setAttachingOpenFileId(candidateId)
    const generation = attachmentGenerationRef.current
    void store
      .attachOpenFile(candidateId, () => generation === attachmentGenerationRef.current)
      .then((attachment) => {
        if (attachment === undefined) {
          if (generation === attachmentGenerationRef.current) setError(t('app.error.openFileGone'))
          return
        }
        if (generation !== attachmentGenerationRef.current) {
          if (!('kind' in attachment)) void store.releaseAttachments([attachment.uri]).catch(() => undefined)
          return
        }
        store.rememberOpenFile(candidateId)
        if (!('kind' in attachment))
          appendAttachment(attachment, candidateId, generation, { kind: 'open-file', id: candidateId })
        setOpenFilePickerOpen(false)
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : t('app.error.attachSelectedFile')),
      )
      .finally(() => {
        attachingOpenFileRef.current = undefined
        setAttachingOpenFileId(undefined)
      })
  }
  const composerOnReferenceQueryChange = useStableCallback(
    (query: string | undefined, quoted: boolean): void => updateReferenceQuery(query, quoted),
  )
  const composerOnPickAttachment = useStableCallback((): void => {
    const generation = attachmentGenerationRef.current
    void store
      .pickAttachment()
      .then((attachment) => {
        if (attachment !== undefined) appendAttachment(attachment, undefined, generation)
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : t('app.error.attachmentSelection')),
      )
  })
  const composerOnIngestFiles = useStableCallback((files: readonly File[]): void => ingestFiles(files))
  const composerOnToggleOpenFilePicker = useStableCallback((): void => toggleOpenFilePicker())
  const composerOnExtrasOpenChange = useStableCallback((open: boolean): void => {
    if (!open) {
      // The picker is rendered inside that menu; leaving it "open" would make
      // the next menu opening start with a stale popover already expanded.
      setOpenFilePickerOpen(false)
      return
    }
    if (activeSessionId === undefined) return
    loadOpenFileCandidates(activeSessionId, false)
  })
  const composerOnSelectOpenFile = useStableCallback((candidateId: string): void =>
    selectOpenFile(candidateId),
  )
  const composerOnRemoveAttachment = useStableCallback((uri: string): void => {
    removeAttachmentDrafts([uri], true)
  })
  const composerOnSubmit = useStableCallback((mode: 'queue' | 'steer', signal?: AbortSignal): Promise<void> =>
    submitPrompt(mode, signal),
  )

  return {
    attachments,
    attachmentPreviews,
    attachmentPreviewFailures,
    visibleOpenFileCandidates,
    visibleOpenFilePickerOpen,
    visibleOpenFilePickerLoading,
    attachedOpenFileIds,
    attachingOpenFileId,
    visibleReferenceCandidates,
    visibleReferenceLoading,
    awaitingFirstPrompt: firstPromptHandoff !== undefined && firstPromptHandoff.sessionId === activeSessionId,
    discardAttachmentDrafts,
    removeAttachmentDrafts,
    composerOnReferenceQueryChange,
    composerOnPickAttachment,
    composerOnIngestFiles,
    composerOnToggleOpenFilePicker,
    composerOnExtrasOpenChange,
    composerOnSelectOpenFile,
    composerOnRemoveAttachment,
    composerOnSubmit,
  }
}

import { Composer, type ComposerProps } from './Composer.js'
import { useDraftValue, setDraft } from '../../app/draft-store.js'
import { useCallback, type ReactElement } from 'react'
import { isInjectedUserTimelineNode } from '../chat/timeline-user-text-facts.js'
import type { AppStore } from '../../app/store.js'
import {
  sameShallowSelection,
  useAppStoreSelector,
  type AppStateSource,
} from '../../app/useAppStoreSelector.js'
import {
  selectGlobalComposerModels,
  selectSessionComposerModels,
  type ComposerModelDirectory,
} from '../../app/store/model-directory-state.js'

type ConnectedComposerProps = Omit<
  ComposerProps,
  'draft' | 'onDraftChange' | 'onModelRetry' | 'readPromptHistory' | keyof ComposerModelDirectory
> & {
  readonly store: AppStateSource & Pick<AppStore, 'refreshSessionModels'>
  readonly modelScope: 'global' | 'session'
}

/**
 * Draft edits and model directory reads subscribe here, keeping their render
 * lifecycle inside the composer rather than the page shell.
 */
export function ConnectedComposer({ store, modelScope, ...props }: ConnectedComposerProps): ReactElement {
  const draft = useDraftValue()
  const directory = useAppStoreSelector(
    store,
    modelScope === 'session' ? selectSessionComposerModels : selectGlobalComposerModels,
    sameShallowSelection,
  )
  const retryModels = useCallback((): void => {
    // The picker already states the failure; a second page banner would repeat it.
    void store.refreshSessionModels().catch(() => undefined)
  }, [store])
  const readPromptHistory = useCallback((): readonly string[] => {
    // Read on demand so streaming patches don't make the composer scan the transcript.
    const { activeSessionId, timeline } = store.getState()
    if (modelScope !== 'session' || activeSessionId === undefined || timeline.sessionId !== activeSessionId)
      return []
    const prompts: string[] = []
    for (let index = timeline.nodes.length - 1; index >= 0 && prompts.length < 100; index -= 1) {
      const node = timeline.nodes[index]
      if (
        node?.kind === 'user-message' &&
        !node.id.startsWith('optimistic:') &&
        !isInjectedUserTimelineNode(node) &&
        node.markdown.trim() !== '' &&
        prompts[prompts.length - 1] !== node.markdown
      )
        prompts.push(node.markdown)
    }
    return prompts
  }, [modelScope, store])
  return (
    <Composer
      {...props}
      {...directory}
      draft={draft}
      onDraftChange={setDraft}
      readPromptHistory={readPromptHistory}
      {...(modelScope === 'session' ? { onModelRetry: retryModels } : {})}
    />
  )
}

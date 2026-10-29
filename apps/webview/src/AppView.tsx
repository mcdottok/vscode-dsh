import { SessionStartupView } from './features/sessions/SessionStartupView.js'
import { useCallback, useState, type ReactElement } from 'react'
import { AppErrorBoundary } from './features/errors/AppErrorBoundary.js'
import { AppSettingsDrawer } from './features/settings/AppSettingsDrawer.js'
import { ScheduleDrawer } from './features/schedules/ScheduleDrawer.js'
import { RuntimeMissingView } from './features/runtime/RuntimeMissingView.js'
import { RuntimeConnectionView } from './features/runtime/RuntimeConnectionView.js'
import { ConnectedComposer } from './features/composer/ConnectedComposer.js'
import { ModsBand } from './features/mods/ModsBand.js'
import { SessionInspector } from './features/inspector/SessionInspector.js'
import type { AppNotice } from './features/shell/AppNotices.js'
import { AppHeader } from './features/shell/AppHeader.js'
import { SessionLineage } from './features/subagents/SessionLineage.js'
import { ExportDialog } from './features/export/ExportDialog.js'
import { GoalsTasksStrip } from './features/goals/GoalsTasksStrip.js'
import { Timeline } from './features/chat/Timeline.js'
import { turnTerminalLabel } from './features/chat/timeline-labels.js'
import { TrajectoryView } from './features/trajectory/TrajectoryView.js'
import { QueuePanel } from './features/input/QueuePanel.js'
import { ApprovalCard } from './features/interactions/ApprovalCard.js'
import { UserQuestionCard } from './features/interactions/UserQuestionCard.js'
import { Icon } from './ui/Icon.js'
import { rememberWelcomeDismissal, rememberRuntimeUpdateDismissal } from './app/dismissed-notices.js'
import type { OpenFileCandidate } from './app/store.js'
import type { useAppController } from './AppController.js'
import { CONVERSATION_VIEW_IDS } from './app/conversation-view-ids.js'
import { useConversationLayout } from './app/ConversationLayoutProvider.js'

const EMPTY_OPEN_FILE_CANDIDATES: readonly OpenFileCandidate[] = []
export function AppView(props: ReturnType<typeof useAppController>): ReactElement {
  const layoutPreference = useConversationLayout()
  const {
    acknowledgeAccountBonusFromSettings,
    active,
    activeRunning,
    activeSubagent,
    activeSubagentState,
    adoptExplicitLocaleFromDsh,
    applyLocale,
    approvalRespondFor,
    assistantLabel,
    attachedOpenFileIds,
    attachingOpenFileId,
    attachmentPreviewFailures,
    attachmentPreviews,
    attachments,
    backend,
    branching,
    busyAction,
    codingToolsEnabled,
    compatibilityWarning,
    composerOnCancel,
    composerOnCaptureEditorContext,
    composerOnCommand,
    composerOnCommandQueryChange,
    composerOnConfigurationChange,
    composerOnDismissSubmitError,
    composerOnExtrasOpenChange,
    composerOnIngestFiles,
    composerOnPickAttachment,
    composerOnPopupSelect,
    composerOnPreviewEditorContext,
    composerOnPromptModeChange,
    composerOnReferenceQueryChange,
    composerOnRemoveAttachment,
    composerOnRemoveEditorContext,
    composerOnSelectOpenFile,
    composerOnSteerQueue,
    composerOnSubmit,
    composerOnToggleOpenFilePicker,
    composerStatus,
    composerSubmitError,
    connectionKey,
    connectionMessage,
    contextPressure,
    contextWindowTokens,
    conversationFontSize,
    conversationFontStyle,
    conversationView,
    dismissedConnection,
    error,
    estimatedContextTokens,
    getScheduleLinkedSession,
    goalOnClear,
    goalOnUpdate,
    headerOnNewSession,
    headerOnOpenSettings,
    conversationFontSizePx,
    imageLimits,
    lineageActiveSubagent,
    lineageOnOpenSession,
    loadAccountDetailsFromSettings,
    locale,
    modelPickerOpenRequest,
    mutateDshSettingsFromDrawer,
    newSessionPresetSelectionEnabled,
    onConversationTabKeyDown,
    openAccountPageFromSettings,
    pendingPermissions,
    pendingQuestions,
    questionWaitFor,
    performanceUsage,
    popupSelects,
    questionCancelFor,
    questionRespondFor,
    queueOnEdit,
    queueOnModeChange,
    queueOnRemove,
    readDshSettingsForUi,
    readyDshUiPreferences,
    respondingInteractionId,
    retryConnection,
    runRuntimeAction,
    runtimeUpdateVersion,
    runtimeUpdateVisible,
    scheduleOnOpenLinkedSession,
    scheduleOnStartSession,
    sessionControl,
    setConversationFontSize,
    setConversationView,
    setDismissedConnection,
    setDismissedRuntimeUpdateVersion,
    setError,
    setExportOpen,
    setThemePreference,
    setWelcomeVisible,
    settingsDrawerVersionKey,
    showDshEvents,
    state,
    store,
    streaming,
    subagentReadOnlyReason,
    t,
    themePreference,
    timelineOnBranch,
    timelineOnFeedback,
    timelineOnFeedbackPrepare,
    timelineOnFeedbackSubmit,
    timelineOnLoadImage,
    timelineOnLoadOlderHistory,
    timelineOnOpenLink,
    timelineOnOpenSession,
    timelineOnShowInFolder,
    transcriptView,
    unsetDshSettingFromDrawer,
    updateDshSettingFromDrawer,
    visibleExportSessionId,
    visibleOpenFileCandidates,
    visibleOpenFilePickerLoading,
    visibleOpenFilePickerOpen,
    visibleReferenceCandidates,
    visibleReferenceLoading,
    welcomeVisible,
  } = props
  const readConnectionSettings = useCallback(() => store.readSettings(), [store])
  const [inspectorReveal, setInspectorReveal] = useState<{
    readonly sessionKey: string
    readonly nodeId: string
    readonly requestId: string
  }>()
  const showWelcome =
    backend.kind === 'connected' &&
    (state.sessionStartup === undefined || state.sessionStartup.kind === 'ready') &&
    active === undefined &&
    state.pendingSession === undefined &&
    state.sessions.length === 0 &&
    state.workspaces.length > 0 &&
    welcomeVisible
  const showConnectionAlert = connectionMessage !== undefined && connectionKey !== dismissedConnection
  const [dismissedTimelineNotices, setDismissedTimelineNotices] = useState<ReadonlySet<string>>(new Set())
  const notices: AppNotice[] = []
  if (error !== undefined) {
    notices.push({
      id: 'error',
      tone: 'danger',
      title: error,
      dismissLabel: t('app.dismissError'),
      onDismiss: () => setError(undefined),
    })
  }
  if (showConnectionAlert && backend.kind === 'connected') {
    notices.push({
      id: 'connection',
      tone: compatibilityWarning === undefined ? 'danger' : 'warning',
      title: compatibilityWarning !== undefined ? t('app.compatibilityWarning') : t('app.connectionFailed'),
      message: connectionMessage,
      dismissLabel: t('app.dismissConnectionError'),
      onDismiss: () => setDismissedConnection(connectionKey),
    })
  }
  if (runtimeUpdateVisible) {
    notices.push({
      id: 'runtime-update',
      tone: 'warning',
      title: t('runtime.updateAvailable'),
      message: t('runtime.updateAvailableDetail', { version: state.dshUpdate?.latestVersion ?? '—' }),
      dismissLabel: t('runtime.dismissUpdate'),
      onDismiss: () => {
        setDismissedRuntimeUpdateVersion(runtimeUpdateVersion)
        rememberRuntimeUpdateDismissal(runtimeUpdateVersion)
      },
      action: { label: t('runtime.openSettings'), icon: 'settings', run: () => store.setDrawer('settings') },
    })
  }
  if (showWelcome) {
    notices.push({
      id: 'welcome',
      tone: 'info',
      title: t('welcome.title'),
      message: t('welcome.description'),
      dismissLabel: t('welcome.dismiss'),
      onDismiss: () => {
        setWelcomeVisible(false)
        rememberWelcomeDismissal()
      },
    })
  }
  // Only this view's live receipts can light the bell; transcript history
  // is never interpreted as the current health of a conversation.
  const sessionNotices = new Map<string, AppNotice>()
  const liveNotificationIds = new Set(state.liveNotificationIds ?? [])
  for (const node of state.timeline.nodes) {
    if (!liveNotificationIds.has(node.id)) continue
    let title: string
    let message: string | undefined
    let tone: AppNotice['tone']
    if (node.kind === 'notice') {
      if (node.level === 'info') continue
      if (node.id.startsWith('connection:') && backend.kind === 'connected') continue
      title = node.text
      tone = node.level === 'error' ? 'danger' : node.level
    } else if (node.kind === 'turn-terminal') {
      title = turnTerminalLabel(node.reason, t)
      message = node.failure?.message
      tone = node.reason === 'error' ? 'danger' : 'warning'
    } else if (node.kind === 'retry') {
      title =
        node.state === 'cancelled'
          ? t('timeline.retryCancelled', { attempt: node.attempt })
          : node.state === 'started'
            ? t('timeline.retryStarted', { attempt: node.attempt })
            : t('timeline.retryingAttempt', { attempt: node.attempt })
      message = node.message
      tone = 'warning'
    } else continue
    const id = `${active?.id ?? 'session'}:${node.id}:${title}:${message ?? ''}`
    const notice: AppNotice = {
      id,
      title,
      tone,
      ...(message === undefined ? {} : { message }),
      dismissLabel: t('app.dismissError'),
      onDismiss: () => setDismissedTimelineNotices((current) => new Set([...current, id].slice(-500))),
    }
    const key = `${tone}:${title}:${message ?? ''}`
    sessionNotices.delete(key)
    sessionNotices.set(key, notice)
    if (sessionNotices.size > 30) sessionNotices.delete(sessionNotices.keys().next().value!)
  }
  notices.push(
    ...[...sessionNotices.values()].reverse().filter((notice) => !dismissedTimelineNotices.has(notice.id)),
  )
  return (
    <AppErrorBoundary>
      <main
        className="dsh-app"
        data-dsh-theme={themePreference}
        data-conversation-layout={layoutPreference?.layout ?? 'classic'}
      >
        <AppHeader
          notices={notices}
          onRetryConnection={retryConnection}
          title={active?.title || (state.pendingSession === undefined ? 'DSH' : t('sessions.new'))}
          runtime={backend}
          connectedDshVersion={state.connectedDshVersion}
          compatibilityWarning={compatibilityWarning}
          sessionControl={sessionControl}
          onNewSession={headerOnNewSession}
          onOpenSettings={headerOnOpenSettings}
        />
        <AppSettingsDrawer
          key={settingsDrawerVersionKey}
          state={state}
          store={store}
          themePreference={themePreference}
          setThemePreference={setThemePreference}
          locale={locale}
          applyLocale={applyLocale}
          adoptExplicitLocaleFromDsh={adoptExplicitLocaleFromDsh}
          conversationFontSize={conversationFontSize}
          setConversationFontSize={setConversationFontSize}
          readDshSettingsForUi={readDshSettingsForUi}
          updateDshSettingFromDrawer={updateDshSettingFromDrawer}
          unsetDshSettingFromDrawer={unsetDshSettingFromDrawer}
          mutateDshSettingsFromDrawer={mutateDshSettingsFromDrawer}
          setError={setError}
          t={t}
          loadAccountDetailsFromSettings={loadAccountDetailsFromSettings}
          acknowledgeAccountBonusFromSettings={acknowledgeAccountBonusFromSettings}
          openAccountPageFromSettings={openAccountPageFromSettings}
        />
        <ScheduleDrawer
          open={state.drawer === 'schedules'}
          onClose={() => store.setDrawer(undefined)}
          featureRequest={store.featureRequest}
          subscribeFeature={store.subscribeFeature}
          onStartScheduleSession={scheduleOnStartSession}
          getLinkedSession={getScheduleLinkedSession}
          onOpenLinkedSession={scheduleOnOpenLinkedSession}
          connectionEpoch={state.connectionEpoch ?? 0}
        />
        <section className="dsh-app__body">
          {backend.kind === 'runtime-missing' ? (
            <RuntimeMissingView
              searchedLocations={backend.searchedLocations}
              busyAction={busyAction}
              onAction={runRuntimeAction}
              onRetry={retryConnection}
              onOpenSettings={() => store.setDrawer('settings')}
              onReadDiagnostics={() => store.readDiagnostics()}
              onReconnectDiagnostics={() => store.reconnect()}
              onShowDiagnosticsOutput={() => store.showDiagnostics()}
            />
          ) : (
            <>
              {active === undefined && state.pendingSession !== undefined ? (
                <section
                  className="dsh-conversation"
                  data-conversation-font-size={conversationFontSize}
                  aria-label={t('app.createSession')}
                >
                  <div
                    className={`dsh-new-chat${backend.kind === 'connected' ? '' : ' dsh-new-chat--connection'}`}
                  >
                    {backend.kind === 'connected' ? (
                      <>
                        <h2>{t('app.newChat.greeting')}</h2>
                        <p>{t('app.newChat.description')}</p>
                        <span className="dsh-new-chat__workspace">
                          <Icon name="folder" />
                          {
                            state.workspaces.find(
                              (workspace) => workspace.id === state.pendingSession?.workspaceId,
                            )?.name
                          }
                        </span>
                      </>
                    ) : (
                      <RuntimeConnectionView
                        {...(state.connectionOutput === undefined ? {} : { output: state.connectionOutput })}
                        state={backend}
                        onReadSettings={readConnectionSettings}
                        initializing={state.connectionInitializing === true}
                        draftPending
                        onRetry={retryConnection}
                        onConnectDesktop={() => store.runtimeAction('connect-desktop')}
                        onOpenSettings={() => store.setDrawer('settings')}
                        onShowDiagnosticsOutput={() => store.showDiagnostics()}
                      />
                    )}
                  </div>
                  <div className="dsh-compose-area">
                    <ConnectedComposer
                      store={store}
                      modelScope="global"
                      key={state.pendingSession.revision}
                      disabled={backend.kind !== 'connected'}
                      running={false}
                      attachments={attachments}
                      attachmentPreviews={attachmentPreviews}
                      attachmentPreviewFailures={attachmentPreviewFailures}
                      editorContext={state.editorContext}
                      editorContextAvailableKinds={state.editorContextAvailableKinds}
                      editorContextLoading={state.editorContextLoading}
                      onCaptureEditorContext={composerOnCaptureEditorContext}
                      onRemoveEditorContext={composerOnRemoveEditorContext}
                      onPreviewEditorContext={composerOnPreviewEditorContext}
                      configuration={state.pendingSession.configuration}
                      configurationDraft
                      permissionPresets={state.newSessionPermissionPresets ?? []}
                      presets={state.presets}
                      presetMutable
                      {...(newSessionPresetSelectionEnabled === undefined
                        ? {}
                        : { presetSelectionEnabled: newSessionPresetSelectionEnabled })}
                      onConfigurationChange={(configuration) => store.configurePendingSession(configuration)}
                      onPickAttachment={composerOnPickAttachment}
                      onIngestFiles={composerOnIngestFiles}
                      openFileCandidates={EMPTY_OPEN_FILE_CANDIDATES}
                      openFilePickerOpen={false}
                      openFilePickerLoading={false}
                      attachedOpenFileIds={[]}
                      onToggleOpenFilePicker={() => undefined}
                      onSelectOpenFile={() => undefined}
                      onRemoveAttachment={composerOnRemoveAttachment}
                      onSubmit={composerOnSubmit}
                      onCancel={() => undefined}
                      onSteerQueue={() => undefined}
                      queue={[]}
                      submitError={composerSubmitError}
                      onDismissSubmitError={composerOnDismissSubmitError}
                    />
                  </div>
                </section>
              ) : active === undefined && backend.kind === 'connected' ? (
                <SessionStartupView
                  store={store}
                  startup={state.sessionStartup}
                  directoryStatus={state.sessionDirectoryStatus}
                />
              ) : active === undefined ? (
                <>
                  <div className="dsh-app__empty">
                    <RuntimeConnectionView
                      {...(state.connectionOutput === undefined ? {} : { output: state.connectionOutput })}
                      state={backend}
                      onReadSettings={readConnectionSettings}
                      initializing={state.connectionInitializing === true}
                      loadingSessionCatalog={backend.kind === 'connected'}
                      onRetry={retryConnection}
                      onConnectDesktop={() => store.runtimeAction('connect-desktop')}
                      onOpenSettings={() => store.setDrawer('settings')}
                      onShowDiagnosticsOutput={() => store.showDiagnostics()}
                    />
                  </div>
                </>
              ) : (
                <section
                  className="dsh-conversation"
                  data-conversation-font-size={conversationFontSize}
                  {...(conversationFontSizePx === undefined
                    ? {}
                    : { 'data-conversation-font-size-px': conversationFontSizePx })}
                  {...(conversationFontStyle === undefined ? {} : { style: conversationFontStyle })}
                  aria-label={active.title.trim() === '' ? t('app.conversation') : active.title}
                >
                  <div className="dsh-conversation__topbar">
                    <div
                      className="dsh-conversation__views"
                      role="tablist"
                      aria-label={t('app.conversationView')}
                    >
                      <button
                        id={CONVERSATION_VIEW_IDS.chat.tab}
                        data-conversation-view="chat"
                        className={`dsh-conversation__view-tab${
                          conversationView === 'chat' ? ' dsh-conversation__view-tab--active' : ''
                        }`}
                        type="button"
                        role="tab"
                        aria-selected={conversationView === 'chat'}
                        aria-controls={CONVERSATION_VIEW_IDS.chat.panel}
                        tabIndex={conversationView === 'chat' ? 0 : -1}
                        onKeyDown={onConversationTabKeyDown}
                        onClick={() => setConversationView('chat')}
                      >
                        {t('app.chat')}
                      </button>
                      <button
                        id={CONVERSATION_VIEW_IDS.trajectory.tab}
                        data-conversation-view="trajectory"
                        className={`dsh-conversation__view-tab${
                          conversationView === 'trajectory' ? ' dsh-conversation__view-tab--active' : ''
                        }`}
                        type="button"
                        role="tab"
                        aria-selected={conversationView === 'trajectory'}
                        aria-controls={CONVERSATION_VIEW_IDS.trajectory.panel}
                        tabIndex={conversationView === 'trajectory' ? 0 : -1}
                        onKeyDown={onConversationTabKeyDown}
                        onClick={() => setConversationView('trajectory')}
                      >
                        {t('app.trajectory')}
                      </button>
                    </div>
                    <GoalsTasksStrip
                      key={active.id}
                      goals={state.goals}
                      todos={state.todos}
                      onUpdateGoal={goalOnUpdate}
                      onClearGoal={goalOnClear}
                    />
                    {activeSubagent !== undefined || active.parentSessionId !== undefined ? (
                      <SessionLineage
                        active={active}
                        {...(lineageActiveSubagent === undefined
                          ? {}
                          : { activeSubagent: lineageActiveSubagent })}
                        sessions={state.sessions}
                        onOpenSession={lineageOnOpenSession}
                      />
                    ) : null}
                  </div>
                  <SessionInspector
                    key={`${state.connectionEpoch}:${active.id}`}
                    {...(state.transcript === undefined ? {} : { eventFacts: state.transcript.eventFacts })}
                    nodes={state.timeline.nodes}
                    hasMore={state.historyHasMore}
                    loading={state.historyLoading}
                    loadOlder={timelineOnLoadOlderHistory}
                    featureRequest={store.featureRequest}
                    showDshEvents={showDshEvents}
                    transcriptView={transcriptView}
                    showTrigger={false}
                    onRevealNode={(nodeId) => {
                      setConversationView('chat')
                      setInspectorReveal({
                        sessionKey: `${state.connectionEpoch}:${active.id}`,
                        nodeId,
                        requestId: crypto.randomUUID(),
                      })
                    }}
                  />
                  {visibleExportSessionId === undefined ? null : (
                    <ExportDialog
                      sessionId={visibleExportSessionId}
                      onClose={() => setExportOpen(false)}
                      onExport={(options) => {
                        setExportOpen(false)
                        void store
                          .exportSession(options)
                          .catch((reason: unknown) =>
                            setError(reason instanceof Error ? reason.message : t('export.failed')),
                          )
                      }}
                    />
                  )}
                  {conversationView === 'chat' ? (
                    <Timeline
                      sessionId={active.id}
                      {...(inspectorReveal?.sessionKey === `${state.connectionEpoch}:${active.id}`
                        ? { revealTarget: inspectorReveal }
                        : {})}
                      panelId={CONVERSATION_VIEW_IDS.chat.panel}
                      panelLabelledBy={CONVERSATION_VIEW_IDS.chat.tab}
                      nodes={state.timeline.nodes}
                      {...(state.timeline.nodeChangeStart === undefined
                        ? {}
                        : { nodeChangeStart: state.timeline.nodeChangeStart })}
                      {...(state.timeline.nodeChangeBase === undefined
                        ? {}
                        : { nodeChangeBase: state.timeline.nodeChangeBase })}
                      streaming={streaming}
                      showDshEvents={showDshEvents}
                      transcriptView={transcriptView}
                      performanceUsage={performanceUsage}
                      codingToolsEnabled={codingToolsEnabled}
                      running={activeRunning}
                      {...(state.timeline.activeTurn === undefined
                        ? {}
                        : { activeTurn: state.timeline.activeTurn })}
                      {...(state.timeline.activeTurnStartedAt === undefined
                        ? {}
                        : { activeTurnStartedAt: state.timeline.activeTurnStartedAt })}
                      assistantLabel={assistantLabel}
                      {...(activeSubagent === undefined ? { onBranch: timelineOnBranch } : {})}
                      branching={branching}
                      onOpenLink={timelineOnOpenLink}
                      onLoadImage={timelineOnLoadImage}
                      onShowInFolder={timelineOnShowInFolder}
                      onOpenSession={timelineOnOpenSession}
                      feedback={state.feedback}
                      feedbackUnavailable={state.feedbackUnavailable}
                      hasMoreHistory={state.historyHasMore}
                      loadingOlderHistory={state.historyLoading}
                      onLoadOlderHistory={timelineOnLoadOlderHistory}
                      {...(state.historyBeforeSequence === undefined
                        ? {}
                        : { historyBeforeSequence: state.historyBeforeSequence })}
                      onFeedback={timelineOnFeedback}
                      onFeedbackPrepare={timelineOnFeedbackPrepare}
                      onFeedbackSubmit={timelineOnFeedbackSubmit}
                    />
                  ) : (
                    <TrajectoryView
                      sessionId={active.id}
                      panelId={CONVERSATION_VIEW_IDS.trajectory.panel}
                      panelLabelledBy={CONVERSATION_VIEW_IDS.trajectory.tab}
                      nodes={state.timeline.nodes}
                      {...(state.timeline.nodeChangeStart === undefined
                        ? {}
                        : { nodeChangeStart: state.timeline.nodeChangeStart })}
                      {...(state.timeline.nodeChangeBase === undefined
                        ? {}
                        : { nodeChangeBase: state.timeline.nodeChangeBase })}
                      streaming={streaming}
                    />
                  )}
                  <QueuePanel
                    key={state.activeSessionId}
                    items={state.queue}
                    directRequestIds={state.directPromptRequestIds}
                    transcript={state.transcript}
                    connected={backend.kind === 'connected'}
                    running={activeRunning}
                    onEdit={queueOnEdit}
                    onRemove={queueOnRemove}
                    onModeChange={queueOnModeChange}
                    onLoadImage={timelineOnLoadImage}
                  />
                  {pendingPermissions.length > 0 || pendingQuestions.length > 0 ? (
                    // No live region here: the cards in this slot carry their
                    // own semantics, and a timed question re-renders its
                    // countdown every 250ms. A `polite` container would queue an
                    // announcement per tick and keep interrupting the user for
                    // as long as the card is on screen. The cards themselves
                    // announce the transitions that matter (an unreachable wait,
                    // a queued reply), and the composer's own `role="status"`
                    // already reports a newly arrived question.
                    <div className="dsh-conversation__interactions">
                      {activeRunning ? null : (
                        <button
                          className="dsh-button dsh-button--danger dsh-button--compact dsh-conversation__interaction-stop"
                          type="button"
                          aria-label={t('composer.stopResponse')}
                          disabled={backend.kind !== 'connected'}
                          onClick={composerOnCancel}
                        >
                          <Icon name="stop" />
                          {t('composer.stop')}
                        </button>
                      )}
                      {pendingPermissions.map(({ request, command }) => (
                        <ApprovalCard
                          key={request.id}
                          request={request}
                          disabled={respondingInteractionId !== undefined}
                          {...(command === undefined ? {} : { command })}
                          onRespond={approvalRespondFor(request)}
                        />
                      ))}
                      {pendingQuestions.map((question) => (
                        <UserQuestionCard
                          key={question.id}
                          question={question}
                          disabled={respondingInteractionId !== undefined}
                          onRespond={questionRespondFor(question)}
                          onCancel={questionCancelFor(question)}
                          {...(question.state === 'open' && question.timed === true
                            ? {
                                onAttachWait: questionWaitFor(question).attach,
                                onReleaseWait: questionWaitFor(question).release,
                              }
                            : {})}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="dsh-compose-area">
                    {backend.kind === 'connected' ? (
                      <ModsBand
                        key={`${state.connectionEpoch}:${active.id}`}
                        sessionId={active.id}
                        featureRequest={store.featureRequest}
                      />
                    ) : null}
                    {subagentReadOnlyReason === undefined || activeRunning ? (
                      <>
                        <ConnectedComposer
                          store={store}
                          modelScope="session"
                          disabled={backend.kind !== 'connected'}
                          inputDisabled={
                            subagentReadOnlyReason !== undefined ||
                            (activeSubagent !== undefined && activeSubagentState?.parentAvailable === false)
                          }
                          attachmentsDisabled={activeSubagent !== undefined && !state.subagentImagePrompts}
                          running={activeRunning}
                          attachments={attachments}
                          {...(activeSubagent === undefined
                            ? {
                                editorContext: state.editorContext,
                                editorContextAvailableKinds: state.editorContextAvailableKinds,
                                editorContextLoading: state.editorContextLoading,
                                onCaptureEditorContext: composerOnCaptureEditorContext,
                                onRemoveEditorContext: composerOnRemoveEditorContext,
                                onPreviewEditorContext: composerOnPreviewEditorContext,
                              }
                            : {})}
                          configuration={state.configuration}
                          presets={state.presets}
                          {...(newSessionPresetSelectionEnabled === undefined
                            ? {}
                            : { presetSelectionEnabled: newSessionPresetSelectionEnabled })}
                          permissionPresets={state.permissionPresets}
                          commands={state.commands}
                          popupSelects={popupSelects}
                          references={visibleReferenceCandidates}
                          referenceLoading={visibleReferenceLoading}
                          {...(imageLimits === undefined ? {} : { imageLimits })}
                          busyEnter={readyDshUiPreferences?.busyEnter ?? state.busyEnter}
                          modelPickerOpenRequest={modelPickerOpenRequest}
                          {...(estimatedContextTokens === undefined ? {} : { estimatedContextTokens })}
                          {...(contextWindowTokens === undefined ? {} : { contextWindowTokens })}
                          {...(contextPressure?.breakdown === undefined
                            ? {}
                            : { contextBreakdown: contextPressure.breakdown })}
                          promptMode={state.promptMode}
                          configurationDisabled={backend.kind !== 'connected'}
                          presetMutable={
                            activeSubagent === undefined && active.blank && active.status === 'idle'
                          }
                          onConfigurationChange={composerOnConfigurationChange}
                          onPromptModeChange={composerOnPromptModeChange}
                          onCommand={composerOnCommand}
                          onOpenSkillDocument={(skillId) => {
                            void store
                              .openSkillDocument(active.id, skillId)
                              .catch((reason: unknown) =>
                                setError(
                                  reason instanceof Error
                                    ? reason.message
                                    : t('commands.openSkillDocumentFailed'),
                                ),
                              )
                          }}
                          onPopupSelect={composerOnPopupSelect}
                          onCommandQueryChange={composerOnCommandQueryChange}
                          onReferenceQueryChange={composerOnReferenceQueryChange}
                          onPickAttachment={composerOnPickAttachment}
                          onIngestFiles={composerOnIngestFiles}
                          attachmentPreviews={attachmentPreviews}
                          attachmentPreviewFailures={attachmentPreviewFailures}
                          openFileCandidates={visibleOpenFileCandidates}
                          openFilePickerOpen={visibleOpenFilePickerOpen}
                          openFilePickerLoading={visibleOpenFilePickerLoading}
                          {...(state.preferredOpenFileId === undefined
                            ? {}
                            : { preferredOpenFileId: state.preferredOpenFileId })}
                          attachedOpenFileIds={attachedOpenFileIds}
                          {...(attachingOpenFileId === undefined ? {} : { attachingOpenFileId })}
                          onToggleOpenFilePicker={composerOnToggleOpenFilePicker}
                          onExtrasOpenChange={composerOnExtrasOpenChange}
                          onSelectOpenFile={composerOnSelectOpenFile}
                          onRemoveAttachment={composerOnRemoveAttachment}
                          onSubmit={composerOnSubmit}
                          onCancel={composerOnCancel}
                          onSteerQueue={composerOnSteerQueue}
                          queue={state.queue}
                          submitError={composerSubmitError}
                          onDismissSubmitError={composerOnDismissSubmitError}
                        />
                        {composerStatus === undefined ? null : (
                          <div className="dsh-composer__status">{composerStatus}</div>
                        )}
                      </>
                    ) : (
                      <div className="dsh-subagent-readonly" role="status">
                        <strong>{t('subagents.readOnly.title')}</strong>
                        <span>
                          {t(
                            subagentReadOnlyReason === 'oneShot'
                              ? 'subagents.readOnly.oneShot'
                              : 'subagents.readOnly.parent',
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </section>
      </main>
    </AppErrorBoundary>
  )
}

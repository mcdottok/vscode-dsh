import type { CustomProviderCreateResult, CustomProviderDraft, ModelProvider } from '@dsh-vscode/domain'
import type { RefObject } from 'react'
import type { ProviderSettingChange } from './ProviderSettingsEditor.js'
import type { Translate } from '../../i18n.js'
import { useStableCallback } from '../../app/useStableCallback.js'
import type { DshSettingsState } from './general-controls.js'
import {
  isKnownRejectedSettingsWrite,
  isSettingsConflict,
  providerSettingOperations,
  settingsNamespaceRevision,
} from './provider-helpers.js'
import type { SettingsDrawerProps } from './settings-drawer-props.js'

export interface ProviderSettingsFlowsDependencies {
  readonly t: Translate
  readonly openEpochRef: RefObject<number>
  readonly dshState: DshSettingsState
  readonly dshSettingsSnapshotFresh: boolean
  readonly busyField: string | undefined
  readonly onLoadDshSettings: SettingsDrawerProps['onLoadDshSettings']
  readonly onRefreshCatalog: SettingsDrawerProps['onRefreshCatalog']
  readonly onMutateDshSettings: SettingsDrawerProps['onMutateDshSettings']
  readonly onCreateCustomProvider: SettingsDrawerProps['onCreateCustomProvider']
  readonly onUnsetDshSetting: SettingsDrawerProps['onUnsetDshSetting']
  readonly onRemoveSecret: SettingsDrawerProps['onRemoveSecret']
  readonly setSaveError: (value: string | undefined) => void
  readonly setBusyField: (value: string | undefined) => void
  readonly setDshState: (value: DshSettingsState) => void
  readonly setDshSettingsSnapshotFresh: (value: boolean) => void
  readonly setEditingProviderId: (value: string | undefined) => void
  readonly closeProviderAddition: () => void
  readonly setRemovingProviderId: (value: string | undefined) => void
}

export interface ProviderSettingsFlows {
  readonly runSecretAction: (key: string, action: () => Promise<void>) => void
  readonly saveProviderChanges: (
    provider: ModelProvider,
    changes: readonly ProviderSettingChange[],
    expectedRevision: number,
    ensureProvider?: boolean,
  ) => Promise<void>
  readonly saveCustomProvider: (
    draft: CustomProviderDraft,
    draftId?: string,
    apiKey?: string,
  ) => Promise<CustomProviderCreateResult>
  readonly removeProvider: (provider: ModelProvider) => Promise<void>
}

export function useProviderSettingsFlows(deps: ProviderSettingsFlowsDependencies): ProviderSettingsFlows {
  const runSecretAction = (key: string, action: () => Promise<void>): void => {
    if (deps.busyField !== undefined) return
    deps.setSaveError(undefined)
    deps.setBusyField(key)
    void action()
      .then(() => deps.onRefreshCatalog())
      .catch((reason: unknown) =>
        deps.setSaveError(reason instanceof Error ? reason.message : deps.t('settings.updateFailed')),
      )
      .finally(() => deps.setBusyField(undefined))
  }

  const saveProviderChanges = useStableCallback(
    async (
      provider: ModelProvider,
      changes: readonly ProviderSettingChange[],
      expectedRevision: number,
      ensureProvider = false,
    ): Promise<void> => {
      if (deps.busyField !== undefined || !deps.dshSettingsSnapshotFresh)
        throw new Error(deps.t('settings.updateFailed'))
      const namespace = provider.settingsNs?.trim()
      if (namespace === undefined || namespace === '') throw new Error(deps.t('settings.updateFailed'))
      const operations =
        changes.length === 0 && ensureProvider
          ? (() => {
              const relativePath = provider.settingsPath ?? []
              return relativePath.length === 0 || relativePath.some((part) => part.trim() === '')
                ? undefined
                : [{ op: 'set' as const, path: relativePath, value: {} }]
            })()
          : providerSettingOperations(provider, changes)
      if (operations === undefined || (operations.length === 0 && ensureProvider))
        throw new Error(deps.t('settings.updateFailed'))
      if (operations.length === 0) return
      deps.setSaveError(undefined)
      deps.setBusyField(`provider:${provider.id}`)
      const epoch = deps.openEpochRef.current
      try {
        try {
          await deps.onMutateDshSettings(namespace, operations, expectedRevision)
        } catch (reason: unknown) {
          const snapshot = await deps.onLoadDshSettings().catch(() => undefined)
          if (deps.openEpochRef.current === epoch) {
            deps.setDshState(
              snapshot === undefined ? { status: 'unavailable' } : { status: 'ready', snapshot },
            )
            deps.setDshSettingsSnapshotFresh(snapshot !== undefined)
            const latestRevision =
              snapshot === undefined ? undefined : settingsNamespaceRevision(snapshot, namespace)
            if (
              isSettingsConflict(reason) ||
              snapshot === undefined ||
              latestRevision !== expectedRevision ||
              !isKnownRejectedSettingsWrite(reason)
            ) {
              deps.setEditingProviderId(undefined)
              if (ensureProvider) deps.closeProviderAddition()
            }
            deps.setSaveError(reason instanceof Error ? reason.message : deps.t('settings.updateFailed'))
          }
          throw reason
        }
        const snapshot = await deps.onLoadDshSettings().catch(() => undefined)
        if (deps.openEpochRef.current !== epoch) return
        if (snapshot === undefined) {
          deps.setDshState({ status: 'unavailable' })
          deps.setDshSettingsSnapshotFresh(false)
          deps.setEditingProviderId(undefined)
          if (ensureProvider) deps.closeProviderAddition()
          return
        }
        deps.setDshState({ status: 'ready', snapshot })
        deps.setDshSettingsSnapshotFresh(true)
        try {
          await deps.onRefreshCatalog()
        } catch (reason: unknown) {
          if (deps.openEpochRef.current !== epoch) return
          // The profile mutation has committed. Keep the editor closed so a
          // catalog refresh failure cannot invite a duplicate write at its old
          // revision.
          deps.setEditingProviderId(undefined)
          if (ensureProvider) deps.closeProviderAddition()
          deps.setSaveError(reason instanceof Error ? reason.message : deps.t('settings.updateFailed'))
        }
      } finally {
        deps.setBusyField(undefined)
      }
    },
  )

  // Readback and catalog refresh are follow-ups to a committed operation.
  // Their errors must not turn a successful write into a duplicate retry.
  const refreshAfterCustomProviderWrite = async (epoch: number): Promise<void> => {
    if (deps.openEpochRef.current !== epoch) return
    const snapshot = await deps.onLoadDshSettings().catch(() => undefined)
    if (deps.openEpochRef.current !== epoch) return
    deps.setDshSettingsSnapshotFresh(snapshot !== undefined)
    if (snapshot === undefined) deps.setSaveError(deps.t('settings.updateFailed'))
    else deps.setDshState({ status: 'ready', snapshot })
    try {
      await deps.onRefreshCatalog()
    } catch (reason: unknown) {
      if (deps.openEpochRef.current === epoch)
        deps.setSaveError(reason instanceof Error ? reason.message : deps.t('settings.updateFailed'))
    }
  }

  const saveCustomProvider = useStableCallback(
    async (
      draft: CustomProviderDraft,
      draftId?: string,
      apiKey?: string,
    ): Promise<CustomProviderCreateResult> => {
      if (deps.busyField !== undefined) throw new Error(deps.t('settings.updateFailed'))
      deps.setSaveError(undefined)
      const path = [draft.settingsNamespace, ...draft.collectionPath, draft.providerId].join('.')
      deps.setBusyField(`provider:${path}`)
      const epoch = deps.openEpochRef.current
      try {
        const result = await deps.onCreateCustomProvider(draft, draftId, apiKey)
        if (result.profileCommitted) await refreshAfterCustomProviderWrite(epoch)
        return result
      } catch (reason: unknown) {
        if (isSettingsConflict(reason) && deps.openEpochRef.current === epoch) {
          const snapshot = await deps.onLoadDshSettings().catch(() => undefined)
          if (snapshot !== undefined && deps.openEpochRef.current === epoch) {
            deps.setDshState({ status: 'ready', snapshot })
            deps.setDshSettingsSnapshotFresh(true)
          }
        }
        throw reason
      } finally {
        deps.setBusyField(undefined)
      }
    },
  )

  const removeProvider = useStableCallback(async (provider: ModelProvider): Promise<void> => {
    if (
      deps.busyField !== undefined ||
      !deps.dshSettingsSnapshotFresh ||
      provider.settingsNs === undefined ||
      provider.settingsPath === undefined
    )
      return
    deps.setSaveError(undefined)
    deps.setBusyField(`remove-provider:${provider.id}`)
    const epoch = deps.openEpochRef.current
    try {
      const expectedRevision =
        deps.dshState.status === 'ready' && deps.dshSettingsSnapshotFresh && provider.settingsNs !== undefined
          ? settingsNamespaceRevision(deps.dshState.snapshot, provider.settingsNs)
          : undefined
      if (expectedRevision === undefined) throw new Error(deps.t('settings.updateFailed'))
      // Commit the CAS protected profile removal before cleaning its secrets.
      // A conflict must not delete credentials while leaving the profile in
      // place. Credential cleanup remains Host-owned and never exposes a key.
      await deps.onUnsetDshSetting(
        [provider.settingsNs, ...provider.settingsPath].join('.'),
        expectedRevision,
      )
      if (deps.openEpochRef.current === epoch) {
        deps.setRemovingProviderId(undefined)
        deps.setEditingProviderId(undefined)
      }
      for (const field of provider.fields) {
        if (!field.secret || field.value === undefined || field.writable === false) continue
        await deps.onRemoveSecret(provider.id, field.key)
      }
      const snapshot = await deps.onLoadDshSettings()
      if (deps.openEpochRef.current !== epoch) return
      if (snapshot === undefined) {
        deps.setDshState({ status: 'unavailable' })
        deps.setDshSettingsSnapshotFresh(false)
        return
      }
      deps.setDshState({ status: 'ready', snapshot })
      deps.setDshSettingsSnapshotFresh(true)
      try {
        await deps.onRefreshCatalog()
      } catch (reason: unknown) {
        if (deps.openEpochRef.current !== epoch) return
        deps.setSaveError(reason instanceof Error ? reason.message : deps.t('settings.updateFailed'))
      }
    } catch (reason: unknown) {
      if (deps.openEpochRef.current === epoch) {
        const snapshot = await deps.onLoadDshSettings().catch(() => undefined)
        if (deps.openEpochRef.current !== epoch) return
        deps.setDshState(snapshot === undefined ? { status: 'unavailable' } : { status: 'ready', snapshot })
        deps.setDshSettingsSnapshotFresh(snapshot !== undefined)
        if (isSettingsConflict(reason)) deps.setRemovingProviderId(undefined)
        deps.setSaveError(reason instanceof Error ? reason.message : deps.t('settings.updateFailed'))
      }
    } finally {
      deps.setBusyField(undefined)
    }
  })
  return {
    runSecretAction,
    saveProviderChanges,
    saveCustomProvider,
    removeProvider,
  }
}

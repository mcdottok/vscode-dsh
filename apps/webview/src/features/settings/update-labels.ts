import type { DshUpdateSnapshot, ExtensionSettingsSummary } from '@dsh-vscode/domain'
import type { Translate } from '../../i18n.js'

export function dshUpdateFailureMessage(failure: DshUpdateSnapshot['failure'], t: Translate): string {
  switch (failure) {
    case 'npm-not-found':
      return t('settings.dshUpdateNpmMissing')
    case 'invalid-response':
      return t('settings.dshUpdateInvalidResponse')
    case 'registry-unavailable':
      return t('settings.dshUpdateRegistryUnavailable')
    default:
      return t('settings.dshUpdateUnavailable')
  }
}

export function connectionModeLabel(
  mode: ExtensionSettingsSummary['connection']['mode'],
  t: Translate,
): string {
  if (mode === 'auto' || mode === 'new-isolated') return t('settings.connectionLocal')
  if (mode === 'custom') return t('settings.connectionDesktop')
  return mode
}

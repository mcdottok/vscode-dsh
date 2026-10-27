import { describe, expect, it } from 'vitest'
import type { DshSettingsSnapshot } from './store.js'
import {
  DSH_UI_SETTING_PATHS,
  CONVERSATION_FONT_SIZE_STORAGE_KEY,
  readConversationFontSize,
  rememberConversationFontSize,
  legacyConversationFontSizePx,
  TRANSCRIPT_VIEW_OPTIONS,
  dshUiPreferences,
  isDshSettingWritable,
  withDshSettingValue,
} from './ui-preferences.js'

function settingsSnapshot(
  options: {
    readonly includeCodingTools?: boolean
    readonly includeBusyEnter?: boolean
    readonly writable?: boolean
  } = {},
): DshSettingsSnapshot {
  const fields: DshSettingsSnapshot['schema']['fields'][number][] = [
    {
      path: DSH_UI_SETTING_PATHS.fontSize,
      label: 'fontSize',
      type: 'number',
      required: false,
      restartRequired: false,
    },
    {
      path: DSH_UI_SETTING_PATHS.transcriptView,
      label: 'transcriptView',
      type: 'enum',
      required: false,
      enumValues: ['compact', 'standard', 'detailed', 'verbose'],
      restartRequired: false,
    },
    {
      path: DSH_UI_SETTING_PATHS.performanceUsage,
      label: 'performanceUsage',
      type: 'enum',
      required: false,
      enumValues: ['compact', 'detailed'],
      restartRequired: false,
    },
  ]
  if (options.includeCodingTools !== false)
    fields.push({
      path: DSH_UI_SETTING_PATHS.codingTools,
      label: 'enabled',
      type: 'boolean',
      required: false,
      restartRequired: false,
    })
  if (options.includeBusyEnter === true)
    fields.push({
      path: DSH_UI_SETTING_PATHS.busyEnter,
      label: 'busyEnter',
      type: 'enum',
      required: false,
      enumValues: ['queue', 'steer'],
      restartRequired: false,
    })
  return {
    schema: {
      version: 'rc2-settings-v1',
      writable: options.writable ?? true,
      hasDocument: false,
      fields,
      namespaces: [],
    },
    values: {
      'ui-chat': { transcriptView: 'verbose', performanceUsage: 'compact' },
      'ui-settings': { enabled: true },
    },
  }
}

describe('DSH UI preferences', () => {
  it('uses rc.2 defaults only for fields declared by the accepted schema', () => {
    const snapshot = settingsSnapshot()
    const preferences = dshUiPreferences(snapshot)

    expect(preferences.fontSize).toBe(13)
    expect(preferences.transcriptView).toBe('verbose')
    expect(preferences.performanceUsage).toBe('compact')
    expect(preferences.codingToolsEnabled).toBe(true)
    expect(
      dshUiPreferences(settingsSnapshot({ includeCodingTools: false })).codingToolsEnabled,
    ).toBeUndefined()
  })

  it('defaults invalid or unset performance usage to detailed while leaving an absent field unsupported', () => {
    const snapshot = settingsSnapshot()
    expect(
      dshUiPreferences({
        ...snapshot,
        values: { ...snapshot.values, 'ui-chat': { performanceUsage: 'future-mode' } },
      }).performanceUsage,
    ).toBe('detailed')
    expect(dshUiPreferences({ ...snapshot, values: {} }).performanceUsage).toBe('detailed')
    expect(
      dshUiPreferences({
        ...snapshot,
        schema: {
          ...snapshot.schema,
          fields: snapshot.schema.fields.filter(
            (field) => field.path !== DSH_UI_SETTING_PATHS.performanceUsage,
          ),
        },
      }).performanceUsage,
    ).toBeUndefined()
    const compact = withDshSettingValue(snapshot, DSH_UI_SETTING_PATHS.performanceUsage, 'compact')
    expect(dshUiPreferences(compact!).performanceUsage).toBe('compact')
  })

  it('accepts every current transcript mode, normalizes legacy values, and leaves missing fields unsupported', () => {
    const snapshot = settingsSnapshot()

    for (const mode of TRANSCRIPT_VIEW_OPTIONS) {
      const selected = {
        ...snapshot,
        values: { ...snapshot.values, 'ui-chat': { transcriptView: mode } },
      }
      expect(dshUiPreferences(selected).transcriptView).toBe(mode)
    }

    expect(
      dshUiPreferences({
        ...snapshot,
        values: { ...snapshot.values, 'ui-chat': { transcriptView: 'normal' } },
      }).transcriptView,
    ).toBe('standard')
    expect(
      dshUiPreferences({
        ...snapshot,
        values: { ...snapshot.values, 'ui-chat': { transcriptView: 'expanded' } },
      }).transcriptView,
    ).toBe('detailed')
    expect(
      dshUiPreferences({
        ...snapshot,
        schema: {
          ...snapshot.schema,
          fields: snapshot.schema.fields.filter(
            (field) => field.path !== DSH_UI_SETTING_PATHS.transcriptView,
          ),
        },
      }).transcriptView,
    ).toBeUndefined()

    const selected = withDshSettingValue(snapshot, DSH_UI_SETTING_PATHS.transcriptView, 'compact')
    expect(dshUiPreferences(selected!).transcriptView).toBe('compact')
  })

  it('reads the busy-send behavior only when the Host schema describes it', () => {
    const snapshot = settingsSnapshot({ includeBusyEnter: true })
    const changed = withDshSettingValue(snapshot, DSH_UI_SETTING_PATHS.busyEnter, 'steer')

    expect(dshUiPreferences(snapshot).busyEnter).toBe('queue')
    expect(dshUiPreferences(changed!).busyEnter).toBe('steer')
    expect(dshUiPreferences(settingsSnapshot()).busyEnter).toBeUndefined()
  })

  it('keeps schema write capability separate from the resolved preference value', () => {
    const snapshot = settingsSnapshot({ writable: false })
    expect(dshUiPreferences(snapshot).codingToolsEnabled).toBe(true)
    expect(isDshSettingWritable(snapshot, DSH_UI_SETTING_PATHS.codingTools, 'boolean')).toBe(false)
  })

  it('does not resolve Developer Tools from a schema declaration without a value', () => {
    const snapshot = settingsSnapshot()

    expect(
      dshUiPreferences({
        ...snapshot,
        values: { ...snapshot.values, 'ui-settings': {} },
      }).codingToolsEnabled,
    ).toBeUndefined()
    expect(
      dshUiPreferences({
        ...snapshot,
        values: { ...snapshot.values, 'ui-settings': { enabled: false } },
      }).codingToolsEnabled,
    ).toBe(false)
  })

  it('updates a local snapshot only for a successfully writable, advertised field', () => {
    const snapshot = settingsSnapshot()
    const updated = withDshSettingValue(snapshot, DSH_UI_SETTING_PATHS.codingTools, false)

    expect(updated).toBeDefined()
    expect(dshUiPreferences(updated!).codingToolsEnabled).toBe(false)
    expect(dshUiPreferences(snapshot).codingToolsEnabled).toBe(true)
    expect(withDshSettingValue(snapshot, 'missing.setting', true)).toBeUndefined()
    expect(
      withDshSettingValue(settingsSnapshot({ writable: false }), DSH_UI_SETTING_PATHS.codingTools, false),
    ).toBeUndefined()
  })
})

describe('local conversation font size', () => {
  it('persists pixel sizes and restores legacy named preferences', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }
    rememberConversationFontSize(16, storage)
    expect(readConversationFontSize(storage)).toBe(16)
    expect(values.get(CONVERSATION_FONT_SIZE_STORAGE_KEY)).toBe('16')
    for (const [name, pixels] of [
      ['small', 12],
      ['medium', 13],
      ['large', 17],
    ] as const) {
      values.set(CONVERSATION_FONT_SIZE_STORAGE_KEY, name)
      expect(legacyConversationFontSizePx(readConversationFontSize(storage))).toBe(pixels)
    }
  })

  it('falls back safely for invalid sizes or unavailable local storage', () => {
    for (const invalid of ['11', '18', '13.5', 'NaN', '', 'unknown']) {
      expect(readConversationFontSize({ getItem: () => invalid, setItem: () => {} })).toBe('medium')
    }
    const storage = {
      getItem: (): string => {
        throw new Error('storage unavailable')
      },
      setItem: (): void => {
        throw new Error('storage unavailable')
      },
    }
    expect(readConversationFontSize(storage)).toBe('medium')
    expect(() => rememberConversationFontSize(16, storage)).not.toThrow()
  })
})

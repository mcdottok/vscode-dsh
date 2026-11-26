import { describe, expect, it } from 'vitest'
import type { DshSettingsSnapshot } from '../../app/store.js'
import { modelReasoningLevels, protocolReasoningLevels } from './provider-helpers.js'

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

const snapshot: DshSettingsSnapshot = {
  schema: {
    version: 'rc6-settings-v2',
    writable: true,
    hasDocument: false,
    fields: [],
    namespaces: [
      {
        ns: 'llm-pi-ai',
        applies: 'live',
        revision: 1,
        userFields: [],
        secrets: [],
        modelReasoningLevels: LEVELS,
      },
      { ns: 'llm-deepseek', applies: 'live', revision: 1, userFields: [], secrets: [] },
    ],
  },
  values: {},
}

describe('provider reasoning schema', () => {
  it('reads the levels only from the namespace that declares them', () => {
    expect(modelReasoningLevels(snapshot, 'llm-pi-ai')).toEqual(LEVELS)
    expect(modelReasoningLevels(snapshot, 'llm-deepseek')).toBeUndefined()
    expect(modelReasoningLevels(snapshot, undefined)).toBeUndefined()
  })

  it('narrows the Gemini protocol to its four fixed levels and leaves others whole', () => {
    expect(protocolReasoningLevels('openai-completions', LEVELS)).toEqual({
      levels: LEVELS,
      levelsOnly: false,
    })
    expect(protocolReasoningLevels('google-generative-ai', LEVELS)).toEqual({
      levels: ['minimal', 'low', 'medium', 'high'],
      levelsOnly: true,
    })
    expect(protocolReasoningLevels(undefined, LEVELS)).toEqual({ levels: LEVELS, levelsOnly: false })
    expect(protocolReasoningLevels('openai-completions', undefined)).toEqual({
      levels: [],
      levelsOnly: false,
    })
  })
})

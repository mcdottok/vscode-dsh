import type { TranscriptViewMode } from '../../app/ui-preferences.js'

/** Adapted from the pinned DSH ui-chat policy; layout never changes Host settings. */
export interface FocusedPresentationPolicy {
  readonly groupTools: boolean
  readonly liveProcessDetail: boolean
  readonly settledReasoningPreview: boolean
}
const POLICIES: Readonly<Record<TranscriptViewMode, FocusedPresentationPolicy>> = {
  compact: {
    groupTools: true,
    liveProcessDetail: false,
    settledReasoningPreview: false,
  },
  standard: {
    groupTools: true,
    liveProcessDetail: true,
    settledReasoningPreview: true,
  },
  detailed: {
    groupTools: false,
    liveProcessDetail: true,
    settledReasoningPreview: true,
  },
  verbose: {
    groupTools: false,
    liveProcessDetail: false,
    settledReasoningPreview: true,
  },
}
export function focusedPresentationPolicy(mode: TranscriptViewMode): FocusedPresentationPolicy {
  return POLICIES[mode]
}

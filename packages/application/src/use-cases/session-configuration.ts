import type { AgentConfiguration, AgentPresetDescriptor } from '@dsh-vscode/domain'

/** Optional transport fields are normalized before producing a Domain configuration. */
export interface SessionConfigurationInput extends Pick<
  AgentConfiguration,
  'preset' | 'toolMode' | 'permissionPreset' | 'planMode'
> {
  readonly sandboxMode?: string | undefined
  readonly approvalPolicy?: string | undefined
  readonly model: Pick<AgentConfiguration['model'], 'providerId' | 'modelId'> & {
    readonly reasoningLevel?: string | undefined
  }
}

/** Keep writable choices separate from configuration projection metadata. */
export function resolveSessionConfigurationForRoster(
  requested: SessionConfigurationInput,
  presets: readonly AgentPresetDescriptor[],
): AgentConfiguration {
  const usable = presets.filter((preset) => preset.broken === undefined)
  const candidates = usable.length > 0 ? usable : presets
  const selected =
    candidates.find((preset) => preset.id === requested.preset) ??
    candidates.find((preset) => preset.isDefault) ??
    candidates[0]

  // Defaults apply to creation only. Updating an existing session must not
  // replace a preserved preset merely because its plugin is absent here.
  return normalizeSessionConfiguration(requested, selected?.id ?? '')
}

export function normalizeSessionConfiguration(
  requested: SessionConfigurationInput,
  preset = requested.preset,
): AgentConfiguration {
  return {
    preset,
    toolMode: requested.toolMode,
    permissionPreset: requested.permissionPreset,
    planMode: requested.planMode,
    ...(requested.sandboxMode === undefined ? {} : { sandboxMode: requested.sandboxMode }),
    ...(requested.approvalPolicy === undefined ? {} : { approvalPolicy: requested.approvalPolicy }),
    model: {
      providerId: requested.model.providerId,
      modelId: requested.model.modelId,
      ...(requested.model.reasoningLevel === undefined
        ? {}
        : { reasoningLevel: requested.model.reasoningLevel }),
    },
  }
}

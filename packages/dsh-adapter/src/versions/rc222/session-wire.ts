import { recordOrUndefined } from '../../repositories/shared/guards.js'
import type { AlphaV4SessionProfile } from '../alpha171/session-wire.js'
import { validCatalogFact } from '../alpha211/session-wire.js'
import { alpha213SessionProfile } from '../alpha213/session-wire.js'

export const rc222SessionProfile: AlphaV4SessionProfile = {
  ...alpha213SessionProfile,
  eventValidators: {
    ...alpha213SessionProfile.eventValidators,
    'subagent/catalog': (value) => {
      const catalog = recordOrUndefined(value)
      if (catalog?.version !== 3) return validCatalogFact(value, true)
      const { name, ...entry } = catalog
      return (
        typeof name === 'string' &&
        /^[a-z][a-z0-9-]{0,31}$/u.test(name) &&
        name !== 'lead' &&
        (entry.mode === 'continuable' || entry.mode === 'external') &&
        validCatalogFact({ ...entry, version: entry.mode === 'external' ? 2 : 1 }, true)
      )
    },
    'team/mode': validTeamMode,
  },
  restoreArtifact(artifact, known) {
    // The V4 codec used by older profiles already checks history structure
    // and child IDs. Check sibling names here before reducing catalog v3.
    const log = recordOrUndefined(artifact)
    if (log === undefined || !Array.isArray(log.events) || typeof log.inheritedEventCount !== 'number')
      throw new Error('Invalid V4 session artifact')
    const inheritedEventCount = log.inheritedEventCount
    const names = new Set<string>()
    const events = log.events.map((value: unknown) => {
      const event = recordOrUndefined(value)
      const catalog = event?.type === 'subagent/catalog' ? recordOrUndefined(event.data) : undefined
      if (event === undefined || catalog?.version !== 3) return value
      if (typeof event.seq === 'number' && event.seq >= inheritedEventCount) {
        const name = catalog.name
        if (typeof name !== 'string' || names.has(name)) throw new Error('Invalid subagent catalog name')
        names.add(name)
      }
      return projectNamedCatalog(event, catalog)
    })
    alpha213SessionProfile.restoreArtifact?.({ ...log, events }, known)
  },
  normalizeEvent(event) {
    // These audit facts preserve history order without enabling Team mode.
    if (event.type === 'team/mode')
      return { type: 'system/message', seq: event.seq, time: event.time, data: {} }
    const catalog = event.type === 'subagent/catalog' ? recordOrUndefined(event.data) : undefined
    const projected = catalog?.version === 3 ? projectNamedCatalog(event, catalog) : event
    return alpha213SessionProfile.normalizeEvent?.(projected) ?? projected
  },
}

function validTeamMode(value: unknown): boolean {
  const mode = recordOrUndefined(value)
  return (
    mode !== undefined &&
    Object.keys(mode).length === 1 &&
    Object.hasOwn(mode, 'enabled') &&
    typeof mode.enabled === 'boolean'
  )
}

function projectNamedCatalog(
  event: Record<string, unknown>,
  catalog: Record<string, unknown>,
): Record<string, unknown> {
  const { name, ...entry } = catalog
  void name
  return { ...event, data: { ...entry, version: entry.mode === 'external' ? 2 : 1 } }
}

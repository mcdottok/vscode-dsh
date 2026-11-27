import { useId, useRef, useState, type ReactElement } from 'react'
import type { Translate } from '../../i18n.js'
import { SelectMenu } from '../../components/common/SelectMenu.js'
import { useDismissibleLayer } from '../../components/common/useDismissibleLayer.js'
import { Icon } from '../../ui/Icon.js'
import type { EditableModel } from './ModelListEditor.js'

/** Levels a declaration starts with, where the schema lists them: Off plus the common trio. */
const INITIAL_LEVELS: readonly string[] = ['off', 'low', 'medium', 'high']

type EffortsEntries = readonly (readonly [string, unknown])[]

/** A reasoning-level failure the Models cards name by row. */
export interface ReasoningEffortsFailure {
  /** Zero-based model position. */
  readonly index: number
  /** Message key owned by the Models settings section. */
  readonly key: 'modelReasoningValueRequired' | 'modelReasoningNeedsLevel' | 'modelReasoningLevelsOnly'
}

/** The wire value a level sends unless its row says otherwise; Off sends nothing. */
function defaultValue(level: string): string | null {
  return level === 'off' ? null : level
}

/**
 * Whether the adapter accepts a stored value: a non-empty string, or nothing
 * for Off. A protocol that accepts its offered levels by name is checked
 * separately by {@link outsideLevels}.
 */
function acceptedValue(level: string, wire: unknown): boolean {
  return typeof wire === 'string' ? wire.length > 0 : wire === null && level === 'off'
}

/** Whether an entry is outside a protocol that accepts only its offered levels. */
function outsideLevels(only: readonly string[], level: string, wire: unknown): boolean {
  return !only.includes(level) || wire !== level
}

/**
 * Read the declared levels from a row in their stored order, including a key
 * the offered levels do not name, so an edit never drops it.
 * @param model - model row as drafted.
 * @returns the entries; empty for a valueless field, which the adapter refuses,
 * and `undefined` when the field is absent or `false` (the switch is off).
 */
function readEfforts(model: EditableModel): EffortsEntries | undefined {
  const value = model['reasoningEfforts']
  if (value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.entries(value as Record<string, unknown>)
}

/**
 * Replace a row's declared levels, preserving every other field.
 * @param model - model row as drafted.
 * @param entries - the levels to write in row order, or `undefined` to remove the field.
 * @returns the replacement row.
 */
function withEfforts(model: EditableModel, entries: EffortsEntries | undefined): EditableModel {
  const next: Record<string, unknown> = { ...model }
  if (entries === undefined) delete next['reasoningEfforts']
  else next['reasoningEfforts'] = Object.fromEntries(entries)
  return next as EditableModel
}

/**
 * Mirror the adapter's refusals for hand-declared `reasoningEfforts`, so the
 * card names the row instead of failing at the write.
 * @param models - drafted model rows.
 * @param levels - levels the schema accepts, in escalation order.
 * @param levelsOnly - whether the protocol accepts only these levels, each sent under its own name.
 * @returns the first refused row, or `undefined` when every row is acceptable.
 */
export function validateReasoningEfforts(
  models: readonly EditableModel[],
  levels: readonly string[],
  levelsOnly: boolean,
): ReasoningEffortsFailure | undefined {
  for (const [index, model] of models.entries()) {
    const entries = readEfforts(model)
    if (entries === undefined) continue
    if (levelsOnly && entries.some(([level, wire]) => outsideLevels(levels, level, wire)))
      return { index, key: 'modelReasoningLevelsOnly' }
    if (entries.some(([level, wire]) => !acceptedValue(level, wire)))
      return { index, key: 'modelReasoningValueRequired' }
    if (!entries.some(([level]) => level !== 'off')) return { index, key: 'modelReasoningNeedsLevel' }
  }
  return undefined
}

export interface ModelReasoningEffortsProps {
  /** Effective model row, including fields outside the curated editor. */
  readonly model: EditableModel
  /** Levels the adapter's schema accepts as `reasoningEfforts` keys, in escalation order. */
  readonly levels: readonly string[]
  /** Whether the route's protocol accepts only {@link levels}, each sent under its own name. */
  readonly levelsOnly: boolean
  /** One-based row position for accessible names. */
  readonly position: number
  /** Prevent changes while read-only or saving. */
  readonly disabled: boolean
  /** Section copy. */
  readonly t: Translate
  /** Replace this row, preserving unrelated configuration. */
  readonly onChange: (model: EditableModel) => void
}

/**
 * Edit the `reasoningEfforts` a hand-declared pi-ai model offers: a switch,
 * then one row per level pairing the level with the wire value sent for it.
 * Every row is read from the model, so a reused instance shows its new model.
 * @param props - model declaration and row replacement action.
 * @returns the reasoning-level group.
 */
export function ModelReasoningEfforts(props: ModelReasoningEffortsProps): ReactElement {
  const { model, levels, levelsOnly, position, disabled, t, onChange } = props
  const entries = readEfforts(model)
  const helpId = useId()
  const helpRef = useRef<HTMLDivElement>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  useDismissibleLayer({ open: helpOpen, refs: [helpRef], onDismiss: () => setHelpOpen(false) })
  // Only the focused field keeps its own text, so a field cleared while typing
  // stays empty although its level's name is stored. Leaving the field drops
  // it, and removing a level resets the buffer with it.
  const [typing, setTyping] = useState<{ level: string; text: string } | undefined>(undefined)
  const used = entries?.map(([level]) => level) ?? []
  const offered = INITIAL_LEVELS.filter((level) => levels.includes(level))
  const initialEntries: EffortsEntries = (offered.length > 0 ? offered : levels).map(
    (level) => [level, defaultValue(level)] as const,
  )

  const write = (next: EffortsEntries | undefined): void => {
    onChange(withEfforts(model, next))
  }
  const replaceAt = (
    current: EffortsEntries,
    index: number,
    entry: readonly [string, unknown],
  ): EffortsEntries => current.map((existing, at) => (at === index ? entry : existing))
  const changeLevel = (
    current: EffortsEntries,
    index: number,
    from: string,
    wire: unknown,
    to: string,
  ): void => {
    // Only a custom spelling between two thinking levels carries over; a value
    // still spelled as its old level, or one crossing to or from Off, resets.
    const carried =
      !levelsOnly &&
      typeof wire === 'string' &&
      wire.length > 0 &&
      wire !== from &&
      from !== 'off' &&
      to !== 'off'
    write(replaceAt(current, index, [to, carried ? wire : defaultValue(to)]))
    setTyping(undefined)
  }
  const addLevel = (current: EffortsEntries): void => {
    const highest = Math.max(-1, ...used.map((level) => levels.indexOf(level)))
    const level =
      levels.find((candidate, index) => index > highest && !used.includes(candidate)) ??
      levels.find((candidate) => !used.includes(candidate))
    if (level === undefined) return
    write([...current, [level, defaultValue(level)]])
    setTyping(undefined)
  }
  const editValue = (current: EffortsEntries, index: number, level: string, text: string): void => {
    setTyping({ level, text })
    const trimmed = text.trim()
    write(replaceAt(current, index, [level, trimmed.length === 0 ? defaultValue(level) : trimmed]))
  }
  const leaveValue = (current: EffortsEntries, index: number, level: string, wire: unknown): void => {
    setTyping(undefined)
    // Leaving a field whose stored value the adapter refuses repairs it with the level name.
    if (!acceptedValue(level, wire)) write(replaceAt(current, index, [level, defaultValue(level)]))
  }

  // A stored key the offered levels do not name stays selectable in its own row.
  const choicesFor = (level: string): readonly string[] => [
    ...(levels.includes(level) ? [] : [level]),
    ...levels.filter((choice) => choice === level || !used.includes(choice)),
  ]
  const outside = levelsOnly && entries?.some(([level, wire]) => outsideLevels(levels, level, wire)) === true
  const refused = entries?.some(([level, wire]) => !acceptedValue(level, wire)) === true
  const missingLevel = entries !== undefined && !used.some((level) => level !== 'off')
  const label = `${t('settings.modelReasoning')} ${String(position)}`

  return (
    <fieldset className="dsh-settings__model-reasoning">
      <legend className="dsh-settings__visually-hidden">{label}</legend>
      <div className="dsh-settings__model-reasoning-heading">
        <span>{t('settings.modelReasoning')}</span>
        <div
          ref={helpRef}
          className="dsh-settings__model-reasoning-help"
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') setHelpOpen(true)
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse' && !event.currentTarget.contains(document.activeElement))
              setHelpOpen(false)
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover'))
              setHelpOpen(false)
          }}
        >
          <button
            className="dsh-settings__model-reasoning-help-trigger"
            type="button"
            aria-label={t('settings.modelReasoningHelp')}
            aria-controls={helpId}
            aria-expanded={helpOpen}
            onFocus={() => setHelpOpen(true)}
            onClick={() => setHelpOpen(true)}
          >
            <Icon name="help" />
          </button>
          <span id={helpId} className="dsh-settings__model-reasoning-hint" role="tooltip" hidden={!helpOpen}>
            {t('settings.modelReasoningHint')}
          </span>
        </div>
        <label className="dsh-settings__switch dsh-settings__model-reasoning-switch">
          <input
            type="checkbox"
            role="switch"
            checked={entries !== undefined}
            disabled={disabled}
            aria-label={label}
            onChange={(event) => {
              write(event.currentTarget.checked ? initialEntries : undefined)
              setTyping(undefined)
            }}
          />
          <span aria-hidden="true" />
        </label>
      </div>
      {entries === undefined ? null : (
        <>
          {entries.length === 0 ? null : (
            <div className="dsh-settings__model-reasoning-head" aria-hidden="true">
              <span>{t('settings.modelReasoningLevel')}</span>
              <span>{t('settings.modelReasoningValue')}</span>
            </div>
          )}
          {entries.map(([level, wire], index) => (
            // A row is the entry at this position of the stored dict: changing
            // its level edits that entry in place, and rows keep no state of
            // their own, so the position is the row's identity.
            <div className="dsh-settings__model-reasoning-row" key={index}>
              <SelectMenu
                className="dsh-settings__model-reasoning-select"
                menuMode="flow"
                label={level}
                ariaLabel={`${t('settings.modelReasoningLevel')} ${String(index + 1)}`}
                title={t('settings.modelReasoningLevel')}
                value={level}
                options={choicesFor(level).map((choice) => ({ value: choice, label: choice }))}
                disabled={disabled}
                onChange={(next) => changeLevel(entries, index, level, wire, next)}
              />
              <input
                type="text"
                value={typing?.level === level ? typing.text : typeof wire === 'string' ? wire : ''}
                placeholder={level === 'off' ? t('settings.modelReasoningOffValue') : level}
                aria-label={`${level} ${t('settings.modelReasoningValue')}`}
                aria-invalid={!acceptedValue(level, wire)}
                // Off only turns reasoning off; a protocol accepting only its
                // offered levels sends each under its own name.
                disabled={disabled || level === 'off' || levelsOnly}
                onChange={(event) => editValue(entries, index, level, event.target.value)}
                onBlur={() => leaveValue(entries, index, level, wire)}
              />
              <button
                className="dsh-icon-button"
                type="button"
                aria-label={`${t('settings.modelReasoningRemove')} ${level}`}
                title={t('settings.modelReasoningRemove')}
                disabled={disabled}
                onClick={() => {
                  write(entries.filter((_entry, at) => at !== index))
                  setTyping(undefined)
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
          {outside ? (
            <p className="dsh-settings__error">{t('settings.modelReasoningLevelsOnly')}</p>
          ) : refused ? (
            <p className="dsh-settings__error">{t('settings.modelReasoningValueRequired')}</p>
          ) : missingLevel ? (
            <p className="dsh-settings__error">{t('settings.modelReasoningNeedsLevel')}</p>
          ) : null}
          <button
            className="dsh-button dsh-button--secondary dsh-button--compact dsh-settings__model-add-action"
            type="button"
            disabled={disabled || levels.every((level) => used.includes(level))}
            onClick={() => addLevel(entries)}
          >
            <Icon name="add" />
            {t('settings.modelReasoningAdd')}
          </button>
        </>
      )}
    </fieldset>
  )
}

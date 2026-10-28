import { isCanonicalWorkspaceRelativePath } from './feature-contracts.js'
import { isValidEditorContextRange, type EditorContextRange } from './editor-context.js'

const PREFIX = 'DSH editor selection v1\n'

/** Persist navigation metadata beside the captured text, without absolute paths or runtime IDs. */
export function encodeEditorSelectionAttachment(
  path: string,
  range: EditorContextRange,
  text: string,
): string {
  return `${PREFIX}${JSON.stringify({ path, range })}\n\n${text}`
}

export function parseEditorSelectionAttachment(
  value: string,
): { readonly text: string; readonly sourceLink: string } | undefined {
  if (!value.startsWith(PREFIX)) return undefined
  const end = value.indexOf('\n\n', PREFIX.length)
  if (end < 0 || end - PREFIX.length > 4096) return undefined
  try {
    const data = JSON.parse(value.slice(PREFIX.length, end)) as unknown
    if (typeof data !== 'object' || data === null || !('path' in data) || !('range' in data)) return undefined
    if (typeof data.path !== 'string' || !isCanonicalWorkspaceRelativePath(data.path)) return undefined
    const range = readRange(data.range)
    if (range === undefined) return undefined
    const path = data.path.split('/').map(encodeURIComponent).join('/')
    const { start, end: last } = range
    return {
      text: value.slice(end + 2),
      sourceLink: `${path}#L${start.line + 1}C${start.column + 1}-L${last.line + 1}C${last.column + 1}`,
    }
  } catch {
    return undefined
  }
}

function readRange(value: unknown): EditorContextRange | undefined {
  if (typeof value !== 'object' || value === null || !('start' in value) || !('end' in value))
    return undefined
  const position = (input: unknown): { line: number; column: number } | undefined => {
    if (typeof input !== 'object' || input === null || !('line' in input) || !('column' in input))
      return undefined
    if (typeof input.line !== 'number' || typeof input.column !== 'number') return undefined
    return { line: input.line, column: input.column }
  }
  const start = position(value.start)
  const end = position(value.end)
  if (start === undefined || end === undefined) return undefined
  const range = { start, end }
  return isValidEditorContextRange(range) ? range : undefined
}

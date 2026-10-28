import { describe, expect, it } from 'vitest'
import {
  encodeEditorSelectionAttachment,
  parseEditorSelectionAttachment,
} from './editor-selection-attachment.js'

describe('persisted editor selections', () => {
  const range = { start: { line: 13, column: 2 }, end: { line: 21, column: 6 } }

  it('retains exact code and an escaped, unambiguous relative source path', () => {
    const text = '  const x = "#"\n\n'
    expect(
      parseEditorSelectionAttachment(encodeEditorSelectionAttachment('src/a #%.ts', range, text)),
    ).toEqual({ text, sourceLink: 'src/a%20%23%25.ts#L14C3-L22C7' })
  })

  it('refuses malformed metadata, unsafe paths and reversed ranges', () => {
    for (const value of [
      'ordinary text',
      'DSH editor selection v1\nnot-json\n\ncode',
      encodeEditorSelectionAttachment('../outside.ts', range, 'code'),
      encodeEditorSelectionAttachment('C:/outside.ts', range, 'code'),
      encodeEditorSelectionAttachment('https://example.com', range, 'code'),
      encodeEditorSelectionAttachment('src/a.ts', { start: range.end, end: range.start }, 'code'),
    ])
      expect(parseEditorSelectionAttachment(value)).toBeUndefined()
  })
})

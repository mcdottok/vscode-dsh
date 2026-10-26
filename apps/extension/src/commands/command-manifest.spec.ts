import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EDITOR_CHAT_VIEW_TYPE } from '../constants.js'
import { COMMANDS } from './register-commands.js'

interface Manifest {
  readonly activationEvents?: readonly string[]
  readonly contributes?: {
    readonly commands?: readonly { readonly command: string }[]
    readonly menus?: Record<
      string,
      readonly { readonly command: string; readonly when?: string; readonly group?: string }[]
    >
  }
}

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as Manifest

const declaredCommands = new Set((manifest.contributes?.commands ?? []).map((entry) => entry.command))

describe('command manifest contributions', () => {
  it('keeps internal compatibility commands out of the user command palette', () => {
    const palette = manifest.contributes?.menus?.commandPalette ?? []
    expect(palette.map((item) => item.command).sort()).toEqual([...declaredCommands].sort())
    expect(palette.filter((item) => item.when !== 'false').map((item) => item.command)).toEqual(
      [
        'dsh.openSidebar',
        'dsh.connectDesktop',
        'dsh.newSession',
        'dsh.openSettings',
        'dsh.openChatInEditor',
        'dsh.moveChatToSidebar',
        'dsh.undoEditorEdit',
        'dsh.showDiagnostics',
        'dsh.clearExternalCredentials',
        'dsh.resetConnection',
      ].sort((a, b) => [...declaredCommands].indexOf(a) - [...declaredCommands].indexOf(b)),
    )
    for (const command of [
      'dsh.shareEditorState',
      'dsh.stopSharingEditorState',
      'dsh.installEditorCompanion',
      'dsh.manageEditorCompanion',
    ])
      expect(palette.find((item) => item.command === command)?.when).toBe('false')
  })
  it('declares every registered command in the extension manifest', () => {
    const missing = COMMANDS.filter((command) => !declaredCommands.has(command))
    expect(missing).toEqual([])
  })

  it('activates for the editor chat surface and its commands', () => {
    const activationEvents = new Set(manifest.activationEvents ?? [])
    expect(activationEvents.has(`onWebviewPanel:${EDITOR_CHAT_VIEW_TYPE}`)).toBe(true)
    for (const command of ['dsh.openChatInEditor', 'dsh.moveChatToSidebar'])
      expect(activationEvents.has(`onCommand:${command}`), `missing activation for ${command}`).toBe(true)
  })

  it('keeps the DSH editor title shortcut available on welcome pages and other editor types', () => {
    expect(manifest.contributes?.menus?.['view/title'] ?? []).toEqual([])
    expect(manifest.contributes?.menus?.['editor/title']).toEqual([
      {
        command: 'dsh.openSidebar',
        group: 'navigation@2',
      },
    ])
    expect(manifest.activationEvents).toContain('onCommand:dsh.openSidebar')
  })

  it('does not send window resize reports for a native toolbar', () => {
    const bootstrap = readFileSync(new URL('../../../../apps/webview/src/main.tsx', import.meta.url), 'utf8')
    expect(bootstrap).not.toContain('watchNativeTitlebarLayout')
  })
})

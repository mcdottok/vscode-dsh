import { expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { resetConnectionSettings } from './reset-connection-settings.js'

vi.mock('vscode', () => ({ ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 } }))

it('removes overrides in user, workspace and every folder without touching other preferences', async () => {
  const scopes = [
    new Map<string, unknown>([
      ['connection.mode', 'custom'],
      ['connection.serverUrl', 'http://127.0.0.1:1'],
      ['runtime.autoStart', true],
      ['model.provider', 'keep'],
    ]),
    new Map<string, unknown>([
      ['connection.serverUrl', 'http://127.0.0.1:2'],
      ['connection.attachPorts', [1234]],
    ]),
    new Map<string, unknown>([
      ['connection.runtimeVersion', '0.2.1-rc.2'],
      ['connection.serverUrl', 'http://127.0.0.1:3'],
    ]),
    new Map<string, unknown>([['connection.attachPorts', [5678]]]),
  ]
  const updates: unknown[][] = []
  const workspace = {
    workspaceFolders: [{ uri: 2 }, { uri: 3 }],
    getConfiguration: (_section: string, folder?: number) => ({
      inspect: (key: string) => ({
        globalValue: scopes[0]?.get(key),
        workspaceValue: scopes[1]?.get(key),
        workspaceFolderValue: scopes[folder ?? 2]?.get(key),
      }),
      update: (key: string, value: unknown, target: number) => {
        updates.push([key, value, target])
        scopes[target === 3 ? (folder ?? 2) : target - 1]?.delete(key)
        return Promise.resolve()
      },
    }),
  } as unknown as Pick<typeof vscode.workspace, 'getConfiguration' | 'workspaceFolders'>
  await resetConnectionSettings(workspace)
  expect(scopes.map((scope) => [...scope.entries()])).toEqual([[['model.provider', 'keep']], [], [], []])
  expect(updates.every(([, value]) => value === undefined)).toBe(true)
  const before = updates.length
  await resetConnectionSettings(workspace)
  expect(updates).toHaveLength(before)
})

it('reports a settings write failure rather than claiming reset succeeded', async () => {
  const workspace = {
    getConfiguration: () => ({
      inspect: () => ({ globalValue: 'fixture' }),
      update: () => Promise.reject(new Error('Fixture settings failure')),
    }),
  } as unknown as Pick<typeof vscode.workspace, 'getConfiguration' | 'workspaceFolders'>
  await expect(resetConnectionSettings(workspace)).rejects.toThrow('Fixture settings failure')
})

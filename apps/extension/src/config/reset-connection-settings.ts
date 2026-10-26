import * as vscode from 'vscode'

const KEYS = [
  'connection.mode',
  'connection.serverUrl',
  'connection.runtimeVersion',
  'connection.attachPorts',
  'runtime.autoStart',
] as const

/** Remove overrides instead of writing an explicit port list, which disables discovery. */
export async function resetConnectionSettings(
  workspace: Pick<typeof vscode.workspace, 'getConfiguration' | 'workspaceFolders'>,
): Promise<void> {
  const settings = workspace.getConfiguration('dsh')
  for (const key of KEYS) {
    const values = settings.inspect(key)
    if (values?.globalValue !== undefined)
      await settings.update(key, undefined, vscode.ConfigurationTarget.Global)
    if (values?.workspaceValue !== undefined)
      await settings.update(key, undefined, vscode.ConfigurationTarget.Workspace)
  }
  for (const folder of workspace.workspaceFolders ?? []) {
    const settings = workspace.getConfiguration('dsh', folder.uri)
    for (const key of KEYS) {
      if (settings.inspect(key)?.workspaceFolderValue !== undefined)
        await settings.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder)
    }
  }
}

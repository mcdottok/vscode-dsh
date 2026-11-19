import type * as vscode from 'vscode'
import { AppError } from '@dsh-vscode/domain'
import { isDshPackageVersion } from '@dsh-vscode/dsh-adapter'

import { DSH_DOCUMENTATION_URL, dshInstallCommand, INSTALL_COMMAND } from '../constants.js'

export interface RuntimeInstallerDependencies {
  readonly window: typeof vscode.window
  readonly env: typeof vscode.env
  readonly Uri: typeof vscode.Uri
  readonly workspace?: typeof vscode.workspace
  readonly verifyExecutable?: (path: string) => Promise<boolean>
  readonly resolveInstallNpm?: (checkedNpm?: string) => Promise<
    | {
        readonly executable: string
        readonly path: string
      }
    | undefined
  >
}

export class RuntimeInstaller {
  public constructor(private readonly dependencies: RuntimeInstallerDependencies) {}

  public async install(version?: string, checkedNpm?: string): Promise<void> {
    if (version !== undefined && (version !== version.trim() || !isDshPackageVersion(version)))
      throw new AppError({
        code: 'INVALID_CONFIGURATION',
        message: 'Select an exact DSH version.',
        retryable: false,
      })
    if (this.dependencies.workspace?.isTrusted === false)
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'Trust this workspace before opening the DSH installation terminal.',
        retryable: false,
      })
    const npm = await this.dependencies.resolveInstallNpm?.(checkedNpm)
    const terminal = this.dependencies.window.createTerminal({
      name: 'Install DSH CLI',
      ...(npm === undefined
        ? {}
        : { shellPath: '/bin/sh', env: { DSH_INSTALL_NPM: npm.executable, DSH_INSTALL_PATH: npm.path } }),
    })
    terminal.show(false)
    // Keep filesystem paths out of the command typed into the terminal.
    const npmCommand = npm === undefined ? 'npm' : 'PATH="$DSH_INSTALL_PATH" "$DSH_INSTALL_NPM"'
    terminal.sendText(dshInstallCommand(version, npmCommand), false)
  }

  public copyInstallCommand(): Thenable<void> {
    return this.dependencies.env.clipboard.writeText(INSTALL_COMMAND).then(() => undefined)
  }

  public async selectExecutable(): Promise<void> {
    const selected = await this.dependencies.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Use DSH executable',
      filters: { Executable: process.platform === 'win32' ? ['cmd', 'exe'] : ['*'] },
    })
    const path = selected?.[0]?.fsPath
    if (path === undefined || this.dependencies.workspace === undefined) return
    if (this.dependencies.verifyExecutable !== undefined && !(await this.dependencies.verifyExecutable(path)))
      throw new AppError({
        code: 'DSH_INCOMPATIBLE',
        message: 'The selected executable is not a supported DSH runtime.',
        retryable: false,
        context: { operation: 'runtime.select', reason: 'invalid-executable' },
      })
    await this.dependencies.workspace.getConfiguration('dsh').update('runtime.executablePath', path, true)
  }

  public openDocumentation(): Thenable<boolean> {
    return this.dependencies.env.openExternal(this.dependencies.Uri.parse(DSH_DOCUMENTATION_URL))
  }
}

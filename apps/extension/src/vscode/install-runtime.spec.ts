import { describe, expect, it, vi } from 'vitest'

import { INSTALL_COMMAND } from '../constants.js'
import { RuntimeInstaller } from './install-runtime.js'

interface Harness {
  readonly installer: RuntimeInstaller
  readonly verifyExecutable: ReturnType<typeof vi.fn>
  readonly createTerminal: ReturnType<typeof vi.fn>
  readonly show: ReturnType<typeof vi.fn>
  readonly sendText: ReturnType<typeof vi.fn>
  readonly showOpenDialog: ReturnType<typeof vi.fn>
  readonly update: ReturnType<typeof vi.fn>
  readonly writeText: ReturnType<typeof vi.fn>
  readonly openExternal: ReturnType<typeof vi.fn>
}

function createHarness(
  options: {
    readonly verifyExecutable?: (path: string) => Promise<boolean>
    readonly isTrusted?: boolean
    readonly selected?: readonly { readonly fsPath: string }[]
  } = {},
): Harness {
  const verifyExecutable = vi.fn(options.verifyExecutable ?? (() => Promise.resolve(true)))
  const sendText = vi.fn()
  const show = vi.fn()
  const createTerminal = vi.fn(() => ({ show, sendText }))
  const showOpenDialog = vi.fn(() => Promise.resolve(options.selected))
  const update = vi.fn(() => Promise.resolve())
  const writeText = vi.fn(() => Promise.resolve())
  const openExternal = vi.fn(() => Promise.resolve(true))
  const installer = new RuntimeInstaller({
    window: { createTerminal, showOpenDialog } as never,
    env: { clipboard: { writeText }, openExternal } as never,
    Uri: { parse: (value: string) => ({ value }) } as never,
    workspace: { isTrusted: options.isTrusted ?? true, getConfiguration: () => ({ update }) } as never,
    verifyExecutable,
  })
  return {
    installer,
    verifyExecutable,
    createTerminal,
    show,
    sendText,
    showOpenDialog,
    update,
    writeText,
    openExternal,
  }
}

describe('runtime installer', () => {
  it('focuses a fresh terminal and fills the pinned command without executing it', async () => {
    const harness = createHarness()

    await harness.installer.install()

    expect(harness.createTerminal).toHaveBeenCalledTimes(1)
    expect(harness.show).toHaveBeenCalledWith(false)
    expect(harness.sendText).toHaveBeenCalledWith(INSTALL_COMMAND, false)
  })

  it('fills the selected exact version in the same way', async () => {
    const harness = createHarness()

    await harness.installer.install('0.2.2-rc.2')

    expect(harness.sendText).toHaveBeenCalledWith('npm install --global "@deepseek-ai/dsh@0.2.2-rc.2"', false)
  })

  it('rejects a shell fragment before creating a terminal', async () => {
    const harness = createHarness()

    await expect(harness.installer.install('0.2.2-rc.2 && whoami')).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    })
    expect(harness.createTerminal).not.toHaveBeenCalled()
  })

  it('requires workspace trust for the native command as well as the Webview', async () => {
    const harness = createHarness({ isTrusted: false })

    await expect(harness.installer.install()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(harness.createTerminal).not.toHaveBeenCalled()
  })

  it('selects an executable only after verification and then pins it in settings', async () => {
    const executable = process.platform === 'win32' ? 'C:\\tools\\dsh.cmd' : '/tools/dsh'
    const harness = createHarness({ selected: [{ fsPath: executable }] })

    await harness.installer.selectExecutable()

    expect(harness.verifyExecutable).toHaveBeenCalledWith(executable)
    expect(harness.update).toHaveBeenCalledWith('runtime.executablePath', executable, true)
  })

  it('refuses an unverified executable without touching settings', async () => {
    const harness = createHarness({
      selected: [{ fsPath: '/tools/not-dsh' }],
      verifyExecutable: () => Promise.resolve(false),
    })

    await expect(harness.installer.selectExecutable()).rejects.toMatchObject({
      code: 'DSH_INCOMPATIBLE',
      context: { operation: 'runtime.select', reason: 'invalid-executable' },
    })
    expect(harness.update).not.toHaveBeenCalled()
  })

  it('leaves settings alone when the dialog is dismissed', async () => {
    const harness = createHarness()

    await expect(harness.installer.selectExecutable()).resolves.toBeUndefined()

    expect(harness.verifyExecutable).not.toHaveBeenCalled()
    expect(harness.update).not.toHaveBeenCalled()
  })

  it('copies the pinned install command and opens the documentation link', async () => {
    const harness = createHarness()

    await harness.installer.copyInstallCommand()
    await harness.installer.openDocumentation()

    expect(INSTALL_COMMAND).toBe('npm install --global "@deepseek-ai/dsh@0.2.1-rc.2"')
    expect(harness.writeText).toHaveBeenCalledWith(INSTALL_COMMAND)
    expect(harness.openExternal).toHaveBeenCalledWith({
      value: 'https://github.com/deepseek-ai/deepseek-harness',
    })
  })
})

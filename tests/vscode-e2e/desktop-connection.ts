import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { runTests } from '@vscode/test-electron'
import { resolveVscodeExecutable } from './vscode-executable.ts'

/** 仅启动测试自有 VS Code；连接现有 Desktop，不启动、停止或接管它。 */
export async function run(): Promise<void> {
  const executable = resolveVscodeExecutable(process.env.DSH_VSCODE_E2E_EXECUTABLE)
  if (process.platform !== 'win32') throw new Error('This Desktop pairing diagnostic requires Windows.')
  const repository = fileURLToPath(new URL('../../', import.meta.url))
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-vscode-'))
  const workspace = path.join(root, 'workspace')
  const userData = path.join(root, 'user-data')
  const extensions = path.join(root, 'extensions')
  const suite = path.join(root, 'desktop-connection-suite.cjs')
  try {
    await Promise.all([
      mkdir(workspace),
      mkdir(path.join(userData, 'User'), { recursive: true }),
      mkdir(extensions),
    ])
    // 产品配对写入 Global；工作区覆写空地址会人为阻止自动配对生效。
    await writeFile(
      path.join(userData, 'User', 'settings.json'),
      JSON.stringify({
        'dsh.connection.mode': 'attach-only',
        'dsh.connection.serverUrl': '',
        'dsh.runtime.autoStart': false,
        'dsh.editor.enabled': false,
        'dsh.editor.autoSetup': false,
        'dsh.connection.discoveryTimeoutMs': 5_000,
        'dsh.connection.requestTimeoutMs': 5_000,
        'dsh.developer.logLevel': 'debug',
      }),
      'utf8',
    )
    // 只构建测试入口；被测扩展使用 Lead 已构建的真实生产 assembly。
    await build({
      entryPoints: [fileURLToPath(new URL('./desktop-connection-suite.ts', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['vscode'],
      outfile: suite,
    })
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: path.join(repository, 'apps', 'extension'),
      extensionTestsPath: suite,
      extensionTestsEnv: {
        ELECTRON_RUN_AS_NODE: undefined,
        DSH_VSCODE_DEV_MANAGED_RUNTIME: undefined,
        DSH_DESKTOP_E2E_ROOT: root,
      },
      launchArgs: [
        workspace,
        '--user-data-dir',
        userData,
        '--extensions-dir',
        extensions,
        '--disable-extensions',
        '--disable-gpu',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
      ],
    })
    console.log('[desktop-vscode-e2e] production auto and custom reconnect remained connected')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
}

await run()

import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'mcdottok.dsh-coding-agent'
const OBSERVATION_MS = 10_000
const POLL_MS = 250

interface ConnectionObservation {
  readonly connected: boolean
  readonly lastState: string | undefined
  readonly failures: readonly string[]
  readonly sequence: readonly string[]
}

export async function run(): Promise<void> {
  const root = process.env.DSH_DESKTOP_E2E_ROOT
  assert.ok(root, 'The diagnostic runner must supply its isolated root.')
  const relative = path.relative(os.tmpdir(), root)
  assert.ok(relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative))
  assert.equal(process.env.DSH_VSCODE_DEV_MANAGED_RUNTIME, undefined)
  assert.equal(vscode.env.remoteName, undefined)
  assert.equal(vscode.workspace.isTrusted, true)
  const settings = vscode.workspace.getConfiguration('dsh')
  assert.equal(settings.get('runtime.autoStart'), false)
  assert.equal(settings.get('editor.enabled'), false)
  assert.equal(settings.get('editor.autoSetup'), false)
  const extension = vscode.extensions.getExtension(EXTENSION_ID)
  assert.ok(extension, 'The actual development extension must be available.')
  console.log(
    `[desktop-vscode-e2e] host node=${process.version} electron=${process.versions.electron ?? 'none'}`,
  )
  await extension.activate()
  await connectProduction(root, 'dsh.connect')
  await observeStableConnection(root, 'automatic')
  assert.equal(vscode.workspace.getConfiguration('dsh').get('connection.mode'), 'custom')
  // 仅改测试自有工作区；移除版本提示后重连，要求生产配对重新识别原实例身份。
  await vscode.workspace
    .getConfiguration('dsh')
    .update('connection.runtimeVersion', '', vscode.ConfigurationTarget.Workspace)
  assert.equal(vscode.workspace.getConfiguration('dsh').get('connection.runtimeVersion'), '')
  await connectProduction(root, 'dsh.reconnect')
  await observeStableConnection(root, 'custom-empty-version')
}

async function connectProduction(root: string, command: string): Promise<void> {
  try {
    const connected: unknown = await vscode.commands.executeCommand(command)
    assert.deepEqual(connected, { connected: true }, 'The real production command must finish.')
  } catch {
    printObservation(await readConnectionObservation(root))
    throw new Error('Production Desktop connect failed; inspect the allowlisted diagnostic above.')
  }
}

async function observeStableConnection(root: string, phase: string): Promise<void> {
  const deadline = Date.now() + OBSERVATION_MS
  let latest: ConnectionObservation = { connected: false, lastState: undefined, failures: [], sequence: [] }
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS))
    latest = await readConnectionObservation(root)
    if (latest.failures.length > 0) {
      printObservation(latest)
      throw new Error('The production Extension Host lost its Desktop connection during observation.')
    }
  }
  printObservation(latest)
  assert.equal(latest.connected, true, 'Actual Output evidence must contain a successful connection.')
  assert.equal(latest.lastState, 'connected', 'The final state must remain connected.')
  console.log(`[desktop-vscode-e2e] phase=${phase} stable observation=${OBSERVATION_MS}ms`)
}

async function readConnectionObservation(root: string): Promise<ConnectionObservation> {
  const files = await findDiagnosticLogs(path.join(root, 'user-data', 'logs'))
  const lines = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).flatMap((text) =>
    text.split(/\r?\n/u),
  )
  const states = lines.filter((line) => line.includes('connection-state '))
  return {
    connected: states.some((line) => line.includes('state=connected')),
    lastState: states.at(-1)?.match(/\bstate=([a-z-]+)/u)?.[1],
    failures: lines
      .filter(
        (line) =>
          line.includes('connection-stream-lost ') ||
          line.includes('trigger=connection-lost ') ||
          line.includes('phase=connect status=failed ') ||
          line.includes('code=PIPE_REFUSED') ||
          line.includes('host-message-rejected '),
      )
      .map(safeDiagnosticLine),
    sequence: lines
      .filter(
        (line) =>
          line.includes('desktop-preparation ') ||
          line.includes('connection-progress ') ||
          line.includes('connection-state '),
      )
      .map(safeDiagnosticLine),
  }
}

async function findDiagnosticLogs(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw new Error('Unable to read the test-owned VS Code diagnostic directory.', { cause: error })
  }
  const files: string[] = []
  for (const entry of entries) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await findDiagnosticLogs(filename)))
    else if (entry.name === 'DSH Coding Agent.log') files.push(filename)
  }
  return files
}

function safeDiagnosticLine(line: string): string {
  const event = line.match(/\] ([a-z-]+)/u)?.[1] ?? 'diagnostic'
  const fields =
    line.match(
      /\b(?:code|phase|status|state|source|trigger|attempt|connectionGeneration)=[A-Za-z0-9_.+-]+/gu,
    ) ?? []
  return [event, ...fields].join(' ')
}

function printObservation(observation: ConnectionObservation): void {
  console.log(
    `[desktop-vscode-e2e] connected=${observation.connected} lastState=${observation.lastState ?? 'missing'} failures=${observation.failures.length}`,
  )
  for (const line of observation.sequence.slice(-80)) console.log(`[desktop-vscode-e2e] ${line}`)
  for (const line of observation.failures.slice(-12)) console.log(`[desktop-vscode-e2e] ${line}`)
}

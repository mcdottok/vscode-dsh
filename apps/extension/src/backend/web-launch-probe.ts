import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface HelpOutput {
  readonly stdout: string
  readonly stderr: string
}

/** Match an option declaration, not an example or an unrelated longer flag. */
export function advertisesNoOpen(help: string): boolean {
  const escape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu')
  return /^\s*(?:-[^\s,]+,\s*)?--no-open(?=[\s,=]|$)/mu.test(help.replace(escape, ''))
}

/**
 * Ask an unknown CLI about its Web options in a disposable profile and cwd.
 * Help output is never logged. Failed probes keep the conservative launch.
 */
export async function probeWebNoOpen(
  runHelp: (directory: string, signal: AbortSignal) => Promise<HelpOutput>,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) throw signal.reason ?? new Error('DSH option probe cancelled')
  let directory: string | undefined
  let temporaryRoot: string | undefined
  try {
    temporaryRoot = await realpath(tmpdir())
    directory = await mkdtemp(path.join(temporaryRoot, 'dsh-web-help-'))
    if (signal.aborted) throw signal.reason ?? new Error('DSH option probe cancelled')
    const help = await runHelp(directory, signal)
    if (signal.aborted) throw signal.reason ?? new Error('DSH option probe cancelled')
    return advertisesNoOpen(`${help.stdout}\n${help.stderr}`)
  } catch (error) {
    if (signal.aborted) throw error
    return false
  } finally {
    if (directory !== undefined && temporaryRoot !== undefined)
      await removeVerifiedProbeDirectory(directory, temporaryRoot)
  }
}

async function removeVerifiedProbeDirectory(directory: string, temporaryRoot: string): Promise<void> {
  const actual = await realpath(directory)
  const same = (left: string, right: string): boolean =>
    process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
  if (
    !same(actual, directory) ||
    !same(path.dirname(actual), temporaryRoot) ||
    !path.basename(actual).startsWith('dsh-web-help-')
  )
    throw new Error('The DSH option probe temporary directory could not be verified.')
  await rm(actual, { recursive: true, force: true })
}

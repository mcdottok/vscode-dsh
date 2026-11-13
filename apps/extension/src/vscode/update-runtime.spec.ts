import { describe, expect, it } from 'vitest'
import type { DshRuntime } from '@dsh-vscode/domain'

import {
  compareVersions,
  DshRuntimeUpdater,
  isDshPackageVersion,
  parseNpmMetadata,
  type ExecuteRuntimeCommand,
} from './update-runtime.js'

const metadata = JSON.stringify({
  'dist-tags': { latest: '0.1.0-rc.7', next: '0.1.0-rc.8' },
  versions: ['0.0.1-rc.1', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8'],
})

function runtime(version = '0.1.0-rc.6'): DshRuntime {
  return {
    executable: 'C:\\dsh\\dsh.cmd',
    version,
    supported: true,
    compatibility: 'known',
    source: 'npm-global',
  }
}

function updater(
  execute: ExecuteRuntimeCommand,
  current = runtime(),
  openInstallTerminal: (version: string) => Promise<void> = () => Promise.resolve(),
): DshRuntimeUpdater {
  return new DshRuntimeUpdater({
    npmExecutable: () => 'npm.cmd',
    locateRuntime: () => Promise.resolve(current),
    execute,
    openInstallTerminal,
    environment: () => ({ PATH: 'test-path' }),
    now: () => new Date('2026-08-21T00:00:00.000Z'),
  })
}

describe('DshRuntimeUpdater', () => {
  it('parses and sorts the real upstream version shape without trusting dist-tags for ordering', () => {
    const parsed = parseNpmMetadata(metadata)

    expect(parsed.versions).toEqual(['0.1.0-rc.8', '0.1.0-rc.7', '0.1.0-rc.6', '0.0.1-rc.1'])
    expect(parsed.latestTagVersion).toBe('0.1.0-rc.7')
    expect(parsed.nextTagVersion).toBe('0.1.0-rc.8')
    expect(compareVersions('0.1.0-rc.8', '0.1.0-rc.7')).toBeGreaterThan(0)
    expect(isDshPackageVersion('0.1.0-rc.8')).toBe(true)
    expect(isDshPackageVersion('0.1.0-rc.8+build.01')).toBe(true)
    expect(isDshPackageVersion('0.1.0-rc.01')).toBe(false)
    expect(isDshPackageVersion('latest')).toBe(false)
    expect(isDshPackageVersion('0.1.0-rc.8 && whoami')).toBe(false)
  })

  it('rejects malformed numeric prerelease identifiers before npm commands', async () => {
    let commandCount = 0
    const execute: ExecuteRuntimeCommand = () => {
      commandCount += 1
      return Promise.resolve({ stdout: '', stderr: '' })
    }

    await expect(updater(execute).installVersion('0.1.0-rc.01')).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
      context: { operation: 'runtime.update', reason: 'invalid-version' },
    })
    expect(commandCount).toBe(0)
  })

  it('accepts npm versions-only responses used by older update paths', () => {
    const parsed = parseNpmMetadata(JSON.stringify(['0.1.0-rc.6', '0.1.0-rc.8', '0.1.0-rc.7']))

    expect(parsed.versions).toEqual(['0.1.0-rc.8', '0.1.0-rc.7', '0.1.0-rc.6'])
    expect(parsed.latestTagVersion).toBeUndefined()
    expect(parsed.nextTagVersion).toBeUndefined()
  })

  it('accepts a single-version JSON response', () => {
    expect(parseNpmMetadata(JSON.stringify('0.1.0-rc.8')).versions).toEqual(['0.1.0-rc.8'])
  })

  it('checks npm metadata and reports an update without starting DSH', async () => {
    const calls: string[][] = []
    const execute: ExecuteRuntimeCommand = async (_executable, args) => {
      await Promise.resolve()
      calls.push([...args])
      if (args[0] === 'view') return { stdout: metadata, stderr: '' }
      if (args[0] === 'list')
        return {
          stdout: JSON.stringify({ dependencies: { '@deepseek-ai/dsh': { version: '0.1.0-rc.6' } } }),
          stderr: '',
        }
      throw new Error(`unexpected command: ${args.join(' ')}`)
    }

    const snapshot = await updater(execute).checkForUpdates()

    expect(snapshot).toMatchObject({
      status: 'ready',
      currentVersion: '0.1.0-rc.6',
      globalVersion: '0.1.0-rc.6',
      latestVersion: '0.1.0-rc.8',
      latestTagVersion: '0.1.0-rc.7',
      nextTagVersion: '0.1.0-rc.8',
      updateAvailable: true,
    })
    expect(calls).toContainEqual(['view', '@deepseek-ai/dsh', '--json'])
    expect(calls).toContainEqual(['list', '--global', '@deepseek-ai/dsh', '--depth=0', '--json'])
    expect(calls.some((args) => args[0] === 'dsh')).toBe(false)
  })

  it('opens the selected version in the terminal and reads the result only on recheck', async () => {
    const requestedVersions: string[] = []
    let installed = '0.1.0-rc.6'
    const execute: ExecuteRuntimeCommand = async (_executable, args) => {
      await Promise.resolve()
      if (args[0] === 'view') return { stdout: metadata, stderr: '' }
      if (args[0] === 'list')
        return {
          stdout: JSON.stringify({ dependencies: { '@deepseek-ai/dsh': { version: installed } } }),
          stderr: '',
        }
      throw new Error(`unexpected command: ${args.join(' ')}`)
    }
    const service = updater(execute, runtime(), (version) => {
      requestedVersions.push(version)
      return Promise.resolve()
    })

    await expect(service.installVersion('0.1.0-rc.8')).resolves.toMatchObject({
      globalVersion: '0.1.0-rc.6',
    })
    expect(requestedVersions).toEqual(['0.1.0-rc.8'])

    installed = '0.1.0-rc.8'
    await expect(service.checkForUpdates(true)).resolves.toMatchObject({
      globalVersion: '0.1.0-rc.8',
    })

    await service.installVersion('0.1.0-rc.8')
    expect(requestedVersions).toEqual(['0.1.0-rc.8'])
  })

  it('returns a bounded unavailable snapshot for malformed registry data', async () => {
    const execute: ExecuteRuntimeCommand = async () => {
      await Promise.resolve()
      return { stdout: '{not-json', stderr: '' }
    }

    await expect(updater(execute).checkForUpdates()).resolves.toMatchObject({
      status: 'unavailable',
      availableVersions: [],
      updateAvailable: false,
      failure: 'invalid-response',
    })
  })

  it('classifies a valid JSON response with no DSH versions as invalid response data', async () => {
    const execute: ExecuteRuntimeCommand = async () => {
      await Promise.resolve()
      return { stdout: JSON.stringify({ versions: [] }), stderr: '' }
    }

    await expect(updater(execute).checkForUpdates()).resolves.toMatchObject({
      status: 'unavailable',
      availableVersions: [],
      updateAvailable: false,
      failure: 'invalid-response',
    })
  })

  it('rejects a requested version that was not returned by the registry', async () => {
    const execute: ExecuteRuntimeCommand = async (_executable, args) => {
      await Promise.resolve()
      if (args[0] === 'view') return { stdout: metadata, stderr: '' }
      if (args[0] === 'list') return { stdout: '{}', stderr: '' }
      throw new Error('install must not run')
    }

    await expect(updater(execute).installVersion('0.1.0-rc.999')).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      context: { operation: 'runtime.update', reason: 'metadata-unavailable' },
    })
  })
})

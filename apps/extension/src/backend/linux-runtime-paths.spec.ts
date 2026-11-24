import { describe, expect, it } from 'vitest'
import { DshRuntimeLocator } from './runtime-locator.js'
import { linuxRuntimePaths } from './linux-runtime-paths.js'

const root = '/home/test/.nvm'
const oldBin = `${root}/versions/node/v24.9.1/bin`
const currentBin = `${root}/versions/node/v24.10.0/bin`
const newerBin = `${root}/versions/node/v26.1.0/bin`
const windowsBin = '/mnt/c/Program Files/nodejs'
const customWindowsBin = '/windows/c/Tools'
type LinuxRuntimeFiles = NonNullable<NonNullable<Parameters<typeof linuxRuntimePaths>[2]>['files']>

function wslRuntimePaths(
  environment: NodeJS.ProcessEnv,
  entries: readonly string[],
  files: LinuxRuntimeFiles,
): ReturnType<typeof linuxRuntimePaths> {
  return linuxRuntimePaths(environment, entries, { wsl: true, files })
}

function fixture(): {
  readonly aliases: Map<string, string>
  readonly executables: Map<string, string>
  readonly files: LinuxRuntimeFiles
} {
  const aliases = new Map([[`${root}/alias/default`, '24\n']])
  const executables = new Map(
    [oldBin, currentBin, newerBin, windowsBin, customWindowsBin, '/usr/bin'].flatMap((bin) =>
      ['node', 'npm'].map((name): [string, string] => [`${bin}/${name}`, `${bin}/${name}`]),
    ),
  )
  return {
    aliases,
    executables,
    files: {
      readDirectories: (directory) =>
        directory === `${root}/versions/node` ? ['v24.9.1', 'v26.1.0', 'v22.9.0', 'v24.10.0'] : [],
      readText: (file) =>
        file === '/proc/self/mountinfo'
          ? '41 30 0:42 / /windows/c rw - 9p C:\\ rw,aname=drvfs;path=C:\\'
          : aliases.get(file),
      executableTarget: (file) => executables.get(file),
    },
  }
}

it('finds nvm on native Linux without an interactive shell or WSL filtering', () => {
  const { files, executables } = fixture()
  executables.set('/mnt/d/bin/npm', '/mnt/d/bin/npm')
  const paths = linuxRuntimePaths({ HOME: '/home/test' }, ['/mnt/d/bin', '/usr/bin'], { files })

  expect(paths.entries).toEqual([currentBin, '/mnt/d/bin', '/usr/bin'])
  expect(paths.npmExecutable()).toBe(`${currentBin}/npm`)
  expect(paths.npmExecutable('/mnt/d/bin/dsh')).toBe('/mnt/d/bin/npm')
})

describe('WSL extension runtime paths', () => {
  it('resolves the installed nvm default and rechecks an alias change despite a stale PATH', () => {
    const { files, aliases } = fixture()
    const environment = { HOME: '/home/test' }
    const inherited = [windowsBin, oldBin, customWindowsBin, '/usr/bin']

    const initial = wslRuntimePaths(environment, inherited, files)
    expect(initial.entries).toEqual([currentBin, oldBin, '/usr/bin'])
    expect(initial.npmExecutable()).toBe(`${currentBin}/npm`)

    aliases.set(`${root}/alias/default`, 'lts/*\n')
    aliases.set(`${root}/alias/lts/*`, 'v26.1.0\n')
    const updated = wslRuntimePaths(environment, [currentBin, ...inherited], files)
    expect(updated.entries).toEqual([newerBin, currentBin, oldBin, '/usr/bin'])
    expect(updated.npmExecutable()).toBe(`${newerBin}/npm`)
    expect(updated.npmExecutable(`${oldBin}/dsh`)).toBe(`${oldBin}/npm`)
  })

  it('does not pick Windows shims from mounted drives or symlinks', () => {
    const { files, executables } = fixture()
    executables.set('/usr/local/bin/npm', `${windowsBin}/npm`)
    const paths = wslRuntimePaths(
      { HOME: '/no-nvm' },
      [windowsBin, '/usr/local/bin', customWindowsBin],
      files,
    )

    expect(paths.entries).toEqual(['/usr/local/bin'])
    expect(paths.npmExecutable(`${customWindowsBin}/dsh`)).toBeUndefined()
  })

  it('finds DSH without a configured path and honors one when provided', async () => {
    const { files, executables, aliases } = fixture()
    for (const bin of [oldBin, currentBin, newerBin, windowsBin]) executables.set(`${bin}/dsh`, `${bin}/dsh`)
    const settings: { executable?: string } = {}
    const locator = new DshRuntimeLocator({
      os: 'linux',
      configuredPath: () => settings.executable,
      pathEntries: () => wslRuntimePaths({ NVM_DIR: root }, [windowsBin, oldBin], files).entries,
      npmGlobalPrefix: () => Promise.resolve(undefined),
      fileExists: (file) => Promise.resolve(executables.has(file)),
      executeVersion: () => Promise.resolve('0.2.2-rc.5'),
    })

    expect((await locator.locate()).runtime?.executable).toBe(`${currentBin}/dsh`)

    executables.delete(`${currentBin}/dsh`)
    locator.invalidate()
    const fallback = (await locator.locate()).runtime
    expect(fallback?.executable).toBe(`${oldBin}/dsh`)
    expect(wslRuntimePaths({ NVM_DIR: root }, [oldBin], files).npmExecutable(fallback?.executable)).toBe(
      `${oldBin}/npm`,
    )
    executables.set(`${currentBin}/dsh`, `${currentBin}/dsh`)

    aliases.set(`${root}/alias/default`, '26')
    locator.invalidate()
    expect((await locator.locate()).runtime?.executable).toBe(`${newerBin}/dsh`)

    settings.executable = `${currentBin}/dsh`
    locator.invalidate()
    expect((await locator.locate()).runtime).toMatchObject({
      executable: settings.executable,
      source: 'configured',
    })
  })

  it('uses native PATH when an alias loops and honors the explicit system alias', () => {
    const { aliases, files } = fixture()
    const environment = { NVM_DIR: root }
    aliases.set(`${root}/alias/default`, 'local')
    aliases.set(`${root}/alias/local`, 'default')
    expect(wslRuntimePaths(environment, ['/usr/bin'], files).npmExecutable()).toBe('/usr/bin/npm')

    aliases.set(`${root}/alias/default`, 'system')
    expect(wslRuntimePaths(environment, [oldBin, '/usr/bin'], files).entries).toEqual(['/usr/bin'])
  })
})

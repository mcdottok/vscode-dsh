import { accessSync, constants, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { posix as path } from 'node:path'

interface WslRuntimeFiles {
  readonly readText: (file: string) => string | undefined
  readonly readDirectories: (directory: string) => readonly string[]
  readonly executableTarget: (file: string) => string | undefined
}

const localFiles: WslRuntimeFiles = {
  readText: (file) => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return undefined
    }
  },
  readDirectories: (directory) => {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
  },
  executableTarget: (file) => {
    try {
      accessSync(file, constants.X_OK)
      return statSync(file).isFile() ? realpathSync(file) : undefined
    } catch {
      return undefined
    }
  },
}

const versionOrder = new Intl.Collator('en', { numeric: true })

/** Resolve the user's nvm default from its installed versions and aliases without loading a shell. */
function nvmDefaultBin(
  nvmDirectory: string,
  isNativeExecutable: (file: string) => boolean,
  files: WslRuntimeFiles,
): string | undefined {
  const versionsDirectory = path.join(nvmDirectory, 'versions/node')
  const visited = new Set<string>()
  let target = 'default'
  while (visited.size < 16 && !visited.has(target)) {
    visited.add(target)
    if (target === 'system') return target
    const versionPrefix = /^v?(\d+(?:\.\d+){0,2})$/u.exec(target)?.[1]
    if (versionPrefix !== undefined || target === 'node' || target === 'stable') {
      const bins = files
        .readDirectories(versionsDirectory)
        .filter(
          (version) =>
            /^v\d+\.\d+\.\d+$/u.test(version) &&
            (versionPrefix === undefined ||
              version === `v${versionPrefix}` ||
              version.startsWith(`v${versionPrefix}.`)),
        )
        .toSorted((left, right) => versionOrder.compare(right, left))
        .map((version) => path.join(versionsDirectory, version, 'bin'))
      return bins.find((bin) => isNativeExecutable(path.join(bin, 'node')))
    }
    if (!/^(?:[a-z\d][a-z\d_.-]*|lts\/(?:\*|[a-z\d][a-z\d_-]*))$/iu.test(target)) return undefined
    const alias = files.readText(path.join(nvmDirectory, 'alias', target))?.trim()
    if (!alias) return undefined
    target = alias
  }
  return undefined
}

function windowsMounts(mountInfo: string | undefined): readonly string[] {
  return (mountInfo ?? '').split('\n').flatMap((line) => {
    const [mount, filesystem] = line.split(' - ')
    const mountPoint = mount?.split(' ')[4]
    if (mountPoint === undefined || !/^(?:drvfs |9p .*\baname=drvfs\b)/u.test(filesystem ?? '')) return []
    return [
      mountPoint.replace(/\\([0-7]{3})/gu, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))),
    ]
  })
}

export function wslRuntimePaths(
  environment: Readonly<NodeJS.ProcessEnv>,
  pathEntries: readonly string[],
  files: WslRuntimeFiles = localFiles,
): { readonly entries: readonly string[]; readonly npmExecutable: (runtime?: string) => string | undefined } {
  const mounts = windowsMounts(files.readText('/proc/self/mountinfo'))
  const nativePath = (entry: string): boolean => {
    if (!path.isAbsolute(entry)) return false
    const normalized = path.normalize(entry)
    return (
      !/^\/mnt\/[a-z](?:\/|$)/iu.test(normalized) &&
      !mounts.some((mount) => normalized === mount || normalized.startsWith(`${mount}/`))
    )
  }
  const isNativeExecutable = (file: string): boolean => {
    const target = files.executableTarget(file)
    return target !== undefined && nativePath(target)
  }
  const base = environment.XDG_CONFIG_HOME || environment.HOME
  const nvmDirectory =
    environment.NVM_DIR || (base && path.join(base, environment.XDG_CONFIG_HOME ? 'nvm' : '.nvm'))
  const nvmRoot =
    nvmDirectory && nativePath(nvmDirectory) ? path.normalize(nvmDirectory).replace(/\/$/u, '') : undefined
  const nvmDefault = nvmRoot === undefined ? undefined : nvmDefaultBin(nvmRoot, isNativeExecutable, files)
  const defaultBin = nvmDefault === 'system' ? undefined : nvmDefault
  const entries = [
    ...new Set([
      ...(defaultBin === undefined ? [] : [defaultBin]),
      ...pathEntries.filter((entry) => {
        if (!nativePath(entry)) return false
        // An explicit system alias opts out of nvm, even if the host inherited an nvm bin.
        return nvmDefault !== 'system' || !path.normalize(entry).startsWith(`${nvmRoot}/versions/node/`)
      }),
    ]),
  ]
  return {
    entries,
    npmExecutable: (runtime) => {
      const sibling = runtime === undefined ? undefined : path.dirname(runtime)
      const candidates = sibling !== undefined && nativePath(sibling) ? [sibling, ...entries] : entries
      return candidates.map((directory) => path.join(directory, 'npm')).find(isNativeExecutable)
    },
  }
}

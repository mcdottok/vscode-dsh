import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const staging = await mkdtemp(path.join(os.tmpdir(), 'dsh-editor-companion-build-'))
try {
  // pnpm 11 不再导出 npm_execpath；按候选路径回退，保持 pnpm 作为唯一构建入口。
  const pnpm = [
    process.env.npm_execpath,
    path.join(os.homedir(), '.local/lib/node_modules/pnpm/bin/pnpm.mjs'),
    '/usr/lib/node_modules/pnpm/bin/pnpm.cjs',
  ].find(
    (candidate) => candidate !== undefined && /\.(?:c?js|mjs)$/u.test(candidate) && existsSync(candidate),
  )
  if (pnpm === undefined) throw new Error('Run the build through pnpm so its executable entry is explicit.')
  const result = spawnSync(
    process.execPath,
    [pnpm, '--filter', '@dsh-vscode/editor-bridge', 'pack', '--pack-destination', staging],
    { cwd: root, shell: false, stdio: 'inherit' },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error('The editor companion bundle could not be packed.')
  const manifest = JSON.parse(
    await readFile(path.join(root, 'packages/dsh-editor-bridge/package.json'), 'utf8'),
  )
  const resources = path.join(root, 'apps/extension/resources')
  await mkdir(resources, { recursive: true })
  await copyFile(
    path.join(staging, `dsh-vscode-editor-bridge-${manifest.version}.tgz`),
    path.join(resources, 'editor-companion.tgz'),
  )
  // A self-contained factory resolves DSH's service from the selected runtime, not
  // from exact-version peer packages installed beside an extension-owned bundle.
  const options = {
    entryPoints: [path.join(root, 'packages/dsh-editor-bridge/src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@deepseek-ai/*'],
    write: false,
    legalComments: 'inline',
  }
  const fingerprint = await build(options)
  const buildId = createHash('sha256').update(fingerprint.outputFiles[0].text).digest('hex')
  const factory = await build({ ...options, define: { __DSH_EDITOR_BUILD_ID__: JSON.stringify(buildId) } })
  await writeFile(
    path.join(resources, 'editor-companion-runtime.mjs'),
    `export function loadCompanion(require) {\nconst module = { exports: {} }; const exports = module.exports;\n${factory.outputFiles[0].text}\nreturn module.exports;\n}\n`,
  )
  await writeFile(path.join(resources, 'editor-companion-build.json'), JSON.stringify({ buildId }) + '\n')
} finally {
  await rm(staging, { recursive: true, force: true })
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readAsarManifest } from './asar-manifest.js'

const electronFs = vi.hoisted(() => ({ require: vi.fn() }))
vi.mock('node:module', () => ({ createRequire: () => electronFs.require }))

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function fixture(metadata?: object): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-asar-identity-'))
  temporary.push(directory)
  const body = Buffer.from('{"name":"@deepseek-ai/dsh-desktop","version":"0.2.1-rc.2"}')
  const json = Buffer.from(
    JSON.stringify({ files: { 'package.json': metadata ?? { size: body.length, offset: '0' } } }),
  )
  const header = Buffer.alloc(8 + json.length + ((4 - (json.length % 4)) % 4))
  header.writeUInt32LE(header.length - 4, 0)
  header.writeUInt32LE(json.length, 4)
  json.copy(header, 8)
  const prefix = Buffer.alloc(8)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(header.length, 4)
  const file = path.join(directory, 'app.asar')
  await writeFile(file, Buffer.concat([prefix, header, body]))
  return file
}
describe('bounded desktop ASAR identity reads', () => {
  it('reads only the selected packed manifest without extracting the archive', async () => {
    const contents = await readAsarManifest(await fixture(), 'package.json')
    expect(JSON.parse(contents)).toEqual({ name: '@deepseek-ai/dsh-desktop', version: '0.2.1-rc.2' })
  })
  it('reads physical archive bytes through original-fs inside Electron without changing global ASAR behavior', async () => {
    const file = await fixture()
    const fs = await import('node:fs')
    const nativeOpen = vi.fn(fs.promises.open)
    electronFs.require.mockReturnValue({ promises: { open: nativeOpen } })
    const originalVersions = process.versions
    const noAsar: unknown = Reflect.get(process, 'noAsar')
    vi.stubGlobal('process', { ...process, versions: { ...originalVersions, electron: '43.7.7' } })
    try {
      const contents = await readAsarManifest(file, 'package.json')
      expect(JSON.parse(contents)).toMatchObject({ version: '0.2.1-rc.2' })
      expect(electronFs.require).toHaveBeenCalledWith('original-fs')
      expect(nativeOpen).toHaveBeenCalledWith(file, 'r')
      expect(Reflect.get(process, 'noAsar')).toBe(noAsar)
      await expect(readAsarManifest(file, '../credentials')).rejects.toThrow('Unsupported')
      expect(nativeOpen).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it.each([
    { offset: '-1', size: 3 },
    { offset: '9007199254740991', size: 3 },
    { offset: '0', size: 33000 },
    { offset: '0', size: 3, unpacked: true },
    { offset: '0', size: 3, link: '../other' },
  ])('refuses malformed, external and oversized members: %j', async (metadata) => {
    await expect(readAsarManifest(await fixture(metadata), 'package.json')).rejects.toThrow(
      'bounded identity',
    )
  })
  it('rejects truncated headers, arbitrary members and already cancelled reads', async () => {
    const file = await fixture()
    await expect(readAsarManifest(file, '../credentials')).rejects.toThrow('Unsupported')
    const controller = new AbortController()
    controller.abort()
    await expect(readAsarManifest(file, 'package.json', controller.signal)).rejects.toThrow()
    await writeFile(file, Buffer.from([4, 0]))
    await expect(readAsarManifest(file, 'package.json')).rejects.toThrow('bounded identity')
  })
})

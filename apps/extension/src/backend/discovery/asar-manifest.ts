import { open, type FileHandle } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type * as NativeFs from 'node:fs'

const MAX_HEADER_BYTES = 16 * 1024 * 1024
const MAX_MANIFEST_BYTES = 32 * 1024
const MEMBERS = new Set(['package.json', 'dsh/node_modules/@deepseek-ai/dsh/package.json'])

/** Read only bounded identity manifests; never extract or execute archive members. */
export async function readAsarManifest(
  archive: string,
  member: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!MEMBERS.has(member)) throw new Error('Unsupported desktop identity member.')
  signal?.throwIfAborted()
  // Electron patches fs to treat .asar files as virtual directories. This
  // reader needs the physical archive bytes, including inside VS Code's Host.
  // Do not toggle process.noAsar: that would affect unrelated extensions.
  const nativeOpen =
    process.versions.electron === undefined
      ? open
      : (createRequire(process.execPath)('original-fs') as typeof NativeFs).promises.open
  const handle = await nativeOpen(archive, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw invalid()
    const prefix = await readExact(handle, 0, 8, signal)
    const headerSize = prefix.readUInt32LE(4)
    if (
      prefix.readUInt32LE(0) !== 4 ||
      headerSize < 8 ||
      headerSize > MAX_HEADER_BYTES ||
      8 + headerSize > stat.size
    )
      throw invalid()
    const header = await readExact(handle, 8, headerSize, signal)
    const jsonSize = header.readUInt32LE(4)
    if (jsonSize < 2 || jsonSize > headerSize - 8) throw invalid()
    let entry: unknown = JSON.parse(header.subarray(8, 8 + jsonSize).toString('utf8'))
    for (const part of member.split('/')) {
      const files = object(object(entry).files)
      if (!Object.hasOwn(files, part)) throw invalid()
      entry = files[part]
    }
    const metadata = object(entry)
    if (
      metadata.unpacked !== undefined ||
      metadata.link !== undefined ||
      typeof metadata.offset !== 'string' ||
      !/^(?:0|[1-9]\d*)$/u.test(metadata.offset) ||
      typeof metadata.size !== 'number' ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 2 ||
      metadata.size > MAX_MANIFEST_BYTES
    )
      throw invalid()
    const offset = Number(metadata.offset)
    const position = 8 + headerSize + offset
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(position) ||
      position + metadata.size > stat.size
    )
      throw invalid()
    return (await readExact(handle, position, metadata.size, signal)).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readExact(
  handle: FileHandle,
  position: number,
  size: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const buffer = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    signal?.throwIfAborted()
    const { bytesRead } = await handle.read(buffer, offset, size - offset, position + offset)
    if (bytesRead === 0) throw invalid()
    offset += bytesRead
  }
  signal?.throwIfAborted()
  return buffer
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function invalid(): Error {
  return new Error('The desktop archive does not contain a bounded identity manifest.')
}

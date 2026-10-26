import { createServer, type Server } from 'node:net'
import { createCipheriv, randomBytes } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopPairing, resolvePairedDesktop } from './desktop-pairing.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

it('clears an in-flight saved pairing after its storage write finishes', async () => {
  const values = new Map<string, string>()
  let finish: () => void = () => undefined
  const blocked = new Promise<void>((resolve) => {
    finish = resolve
  })
  const store = vi.fn(async (name: string, value: string): Promise<void> => {
    await blocked
    values.set(name, value)
  })
  const pairing = new DesktopPairing(
    {
      get: (name) => Promise.resolve(values.get(name)),
      store,
      delete: (name) => {
        values.delete(name)
        return Promise.resolve()
      },
    },
    'win32',
  )
  const saving = pairing.save('http://127.0.0.1:41234', {
    version: 1,
    key: randomBytes(32).toString('base64url'),
  })
  await vi.waitFor(() => expect(store).toHaveBeenCalled())
  const clearing = pairing.clear()
  finish()
  await Promise.all([saving, clearing])
  expect(values.size).toBe(0)
})

async function host(key: string, url: string, tamper = false): Promise<string> {
  const pipe =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsh-vscode-test-${randomBytes(16).toString('hex')}`
      : `/tmp/dsh-vscode-${randomBytes(12).toString('hex')}.sock`
  const server = createServer((socket) => {
    let input = ''
    socket.on('error', () => undefined)
    socket.on('data', (chunk) => {
      input += chunk.toString()
      if (!input.includes('\n')) return
      const { nonce } = JSON.parse(input) as { nonce: string }
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv)
      cipher.setAAD(Buffer.from(nonce))
      const body = Buffer.concat([cipher.update(JSON.stringify({ url, nonce })), cipher.final()])
      socket.end(
        JSON.stringify({
          iv: iv.toString('hex'),
          body: body.toString('hex'),
          tag: tamper ? '00'.repeat(16) : cipher.getAuthTag().toString('hex'),
        }) + '\n',
      )
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(pipe, resolve))
  return pipe
}

it('accepts only authenticated encrypted loopback launch addresses', async () => {
  const key = randomBytes(32).toString('base64url')
  const url = 'http://127.0.0.1:41234/?token=fixture-token'
  await expect(resolvePairedDesktop(key, undefined, await host(key, url))).resolves.toBe(url)
  await expect(resolvePairedDesktop(key, undefined, await host(key, url, true))).rejects.toThrow(
    'unavailable',
  )
  await expect(
    resolvePairedDesktop(key, undefined, await host(key, 'http://example.com/?token=fixture')),
  ).rejects.toThrow('unavailable')
})

it('cancels IPC without returning credentials', async () => {
  const abort = new AbortController()
  abort.abort()
  await expect(resolvePairedDesktop(randomBytes(32).toString('base64url'), abort.signal)).rejects.toThrow(
    'unavailable',
  )
})

it('isolates native pairing grants by the explicitly selected origin', async () => {
  const values = new Map<string, string>()
  const secrets = {
    get: vi.fn((name: string) => Promise.resolve(values.get(name))),
    store: vi.fn((name: string, value: string) => {
      values.set(name, value)
      return Promise.resolve()
    }),
    delete: vi.fn((name: string) => {
      values.delete(name)
      return Promise.resolve()
    }),
  }
  const pairing = new DesktopPairing(secrets, 'win32')
  const origin = 'http://127.0.0.1:41234'
  await pairing.save(origin, { version: 1, key: randomBytes(32).toString('base64url') })
  expect(await pairing.has(origin)).toBe(true)
  expect(await pairing.has('http://127.0.0.1:42345')).toBe(false)
  await pairing.clear()
  expect(await pairing.has(origin)).toBe(false)
})

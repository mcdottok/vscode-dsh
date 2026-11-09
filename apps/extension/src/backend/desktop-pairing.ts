import { createConnection } from 'node:net'
import { createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { parseDesktopLaunchUrl } from '../vscode/connect-desktop.js'
import type { RedactedDiagnostics } from './diagnostics.js'

interface PairingRecord {
  readonly version: 1
  readonly key: string
  readonly origin: string
}
interface Secrets {
  get(key: string): PromiseLike<string | undefined>
  store(key: string, value: string): PromiseLike<void>
  delete(key: string): PromiseLike<void>
}
const SLOT = 'dsh.desktop.localPairing.v1'

type DesktopPairingFailure =
  | 'PIPE_TIMEOUT'
  | 'PIPE_NOT_FOUND'
  | 'PIPE_REFUSED'
  | 'PIPE_ACCESS_DENIED'
  | 'PIPE_OPERATION_DENIED'
  | 'PIPE_ERROR'
  | 'PIPE_CLOSED'
  | 'INVALID_PAIRING_RESPONSE'
  | 'REQUEST_CANCELLED'

export class DesktopPairingError extends Error {
  public constructor(readonly code: DesktopPairingFailure) {
    super('Paired Desktop unavailable')
  }
}

export function isPairingTransportFailure(error: unknown): error is DesktopPairingError {
  return (
    error instanceof DesktopPairingError &&
    [
      'PIPE_TIMEOUT',
      'PIPE_NOT_FOUND',
      'PIPE_REFUSED',
      'PIPE_ACCESS_DENIED',
      'PIPE_OPERATION_DENIED',
    ].includes(error.code)
  )
}

export function resolvePairedDesktop(key: string, signal?: AbortSignal, pipe?: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(key)) return Promise.reject(new Error('Invalid desktop pairing'))
  return new Promise((resolve, reject) => {
    const nonce = randomBytes(32).toString('hex')
    const time = Date.now()
    const path = pipe ?? `\\\\.\\pipe\\dsh-vscode-${createHash('sha256').update(key).digest('hex')}`
    const socket = createConnection(path)
    const deadline = setTimeout(() => finish(undefined, 'PIPE_TIMEOUT'), 2000)
    let input = ''
    let complete = false
    const finish = (
      url: string | undefined,
      code: DesktopPairingFailure = 'INVALID_PAIRING_RESPONSE',
    ): void => {
      if (complete) return
      complete = true
      clearTimeout(deadline)
      signal?.removeEventListener('abort', abort)
      socket.destroy()
      if (url === undefined) reject(new DesktopPairingError(code))
      else resolve(url)
    }
    const abort = (): void => finish(undefined, 'REQUEST_CANCELLED')
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    socket.setTimeout(2000, () => finish(undefined, 'PIPE_TIMEOUT'))
    socket.on('error', (error: NodeJS.ErrnoException) => {
      const { code } = error
      if (code === 'ENOENT') finish(undefined, 'PIPE_NOT_FOUND')
      else if (code === 'ECONNREFUSED') finish(undefined, 'PIPE_REFUSED')
      else if (code === 'EACCES') finish(undefined, 'PIPE_ACCESS_DENIED')
      else if (code === 'EPERM') finish(undefined, 'PIPE_OPERATION_DENIED')
      else finish(undefined, 'PIPE_ERROR')
    })
    socket.on('close', () => finish(undefined, 'PIPE_CLOSED'))
    socket.on('connect', () => {
      const mac = createHmac('sha256', Buffer.from(key, 'base64url'))
        .update(`request:${nonce}:${time}`)
        .digest('hex')
      socket.write(JSON.stringify({ nonce, time, mac }) + '\n')
    })
    socket.on('data', (chunk: Buffer) => {
      input += chunk.toString('utf8')
      if (input.length > 20_000) {
        finish(undefined)
        return
      }
      if (!input.includes('\n')) return
      try {
        const value: unknown = JSON.parse(input.slice(0, input.indexOf('\n')))
        if (
          !value ||
          typeof value !== 'object' ||
          !('iv' in value) ||
          !('body' in value) ||
          !('tag' in value) ||
          typeof value.iv !== 'string' ||
          !/^[a-f0-9]{24}$/u.test(value.iv) ||
          typeof value.tag !== 'string' ||
          !/^[a-f0-9]{32}$/u.test(value.tag) ||
          typeof value.body !== 'string' ||
          !/^(?:[a-f0-9]{2}){1,9000}$/u.test(value.body)
        )
          throw new Error('Invalid response')
        const cipher = createDecipheriv(
          'aes-256-gcm',
          Buffer.from(key, 'base64url'),
          Buffer.from(value.iv, 'hex'),
        )
        cipher.setAAD(Buffer.from(nonce))
        cipher.setAuthTag(Buffer.from(value.tag, 'hex'))
        const body: unknown = JSON.parse(
          Buffer.concat([cipher.update(Buffer.from(value.body, 'hex')), cipher.final()]).toString('utf8'),
        )
        if (
          !body ||
          typeof body !== 'object' ||
          !('nonce' in body) ||
          body.nonce !== nonce ||
          !('url' in body) ||
          typeof body.url !== 'string'
        )
          throw new Error('Invalid response')
        const launch = parseDesktopLaunchUrl(body.url)
        if (
          launch.endpoint.host !== '127.0.0.1' ||
          new URL(launch.endpoint.baseUrl).protocol !== 'http:' ||
          !launch.token
        )
          throw new Error('Invalid local address')
        finish(body.url)
      } catch {
        finish(undefined)
      }
    })
  })
}

function pairingChange(
  previous: string | undefined,
  current: string,
): 'first-read' | 'address-changed' | 'token-only' | 'url-format-changed' | 'unclassified' {
  if (previous === undefined) return 'first-read'
  try {
    const before = parseDesktopLaunchUrl(previous)
    const after = parseDesktopLaunchUrl(current)
    if (before.endpoint.baseUrl !== after.endpoint.baseUrl) return 'address-changed'
    if (before.token !== after.token) return 'token-only'
    return 'url-format-changed'
  } catch {
    return 'unclassified'
  }
}

/** Pairing keys remain in native SecretStorage; never enter configuration or the Webview. */
export class DesktopPairing {
  private lastLaunch: string | undefined
  private mutation: Promise<void> = Promise.resolve()
  public constructor(
    private readonly secrets: Secrets,
    private readonly platform = process.platform,
    private readonly diagnostics?: Pick<RedactedDiagnostics, 'log'>,
  ) {}
  private async read(origin: string): Promise<PairingRecord | undefined> {
    if (this.platform !== 'win32') return undefined
    try {
      await this.mutation
      const raw = await this.secrets.get(SLOT)
      if (!raw) return undefined
      const record = JSON.parse(raw) as Partial<PairingRecord>
      return record.version === 1 &&
        record.origin === origin &&
        typeof record.key === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(record.key)
        ? (record as PairingRecord)
        : undefined
    } catch {
      return undefined
    }
  }
  public async resolve(origin: string, signal?: AbortSignal): Promise<string | undefined> {
    const record = await this.read(origin)
    const url = record ? await resolvePairedDesktop(record.key, signal) : undefined
    this.lastLaunch = url
    return url
  }
  public async changed(
    origin: string,
    signal?: AbortSignal,
    getConnectedOrigin?: () => string | undefined,
  ): Promise<boolean> {
    const previous = this.lastLaunch
    const url = await this.resolve(origin, signal)
    if (url === undefined || url === previous) return false
    const change = pairingChange(previous, url)
    const connectedOrigin = change === 'first-read' ? getConnectedOrigin?.() : undefined
    // resolve() has already saved the first address as the next comparison baseline.
    const baseline =
      connectedOrigin !== undefined && parseDesktopLaunchUrl(url).endpoint.baseUrl === connectedOrigin
    this.diagnostics?.log('info', 'desktop-pairing-change', {
      change,
      status: baseline ? 'baseline' : 'changed',
    })
    return !baseline
  }
  public async has(origin: string): Promise<boolean> {
    return (await this.read(origin)) !== undefined
  }
  /** Host-only identity constraint for re-discovery; never publish or log this value. */
  public async keyFor(origin: string): Promise<string | undefined> {
    return (await this.read(origin))?.key
  }
  public async save(origin: string, value: unknown): Promise<void> {
    if (
      this.platform !== 'win32' ||
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('key' in value) ||
      typeof value.key !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(value.key)
    )
      return
    const record = JSON.stringify({ version: 1, origin, key: value.key })
    await this.mutate(() => this.secrets.store(SLOT, record))
  }
  public async clear(): Promise<void> {
    this.lastLaunch = undefined
    await this.mutate(() => this.secrets.delete(SLOT))
  }
  private mutate(operation: () => PromiseLike<void>): Promise<void> {
    const next = this.mutation.then(operation)
    this.mutation = next.catch(() => undefined)
    return next
  }
}

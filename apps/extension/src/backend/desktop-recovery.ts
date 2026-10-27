import { AppError, isLoopbackEndpoint, parseServerOrigin, type BackendState } from '@dsh-vscode/domain'

export function desktopRecoveryState(state: BackendState, recovering: boolean): BackendState {
  return recovering && ['failed', 'idle', 'stopping'].includes(state.kind)
    ? { kind: 'discovering', attempt: 1, phase: 'discovery' }
    : state
}

/** Recovery never starts a runtime or redirects a remote/custom network target. */
export function canRecoverDesktop(connection: {
  readonly mode: string
  readonly serverUrl?: string
  readonly attachPortsConfigured?: boolean
}): boolean {
  if (connection.attachPortsConfigured === true && !connection.serverUrl?.trim()) return false
  if (['auto', 'attach-only'].includes(connection.mode) && !connection.serverUrl?.trim()) return true
  const endpoint = parseServerOrigin(connection.serverUrl ?? '')
  return connection.mode === 'custom' && endpoint !== undefined && isLoopbackEndpoint(endpoint)
}

export function isRecoverableDesktopError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    ['BACKEND_UNREACHABLE', 'NO_RUNNING_INSTANCE', 'AUTH_REQUIRED', 'PERMISSION_DENIED'].includes(error.code)
  )
}

/** One bounded recovery window. Abort and terminal protocol/configuration errors stop immediately. */
export async function withDesktopRecovery<T>(options: {
  readonly connect: () => Promise<T>
  readonly refresh: () => Promise<void>
  readonly signal?: AbortSignal
  readonly active: (value: boolean) => void
}): Promise<T> {
  options.active(true)
  try {
    for (const delay of [0, 750, 2000, 4000, 6000]) {
      await waitForRetry(delay, options.signal)
      try {
        if (delay > 0) await options.refresh()
        return await options.connect()
      } catch (error) {
        options.signal?.throwIfAborted()
        if (!isRecoverableDesktopError(error) || delay === 6000) throw error
      }
    }
    throw new Error('Desktop recovery exhausted')
  } finally {
    options.active(false)
  }
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (delay === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Recovery cancelled.', 'AbortError'),
      )
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delay)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

import type * as vscode from 'vscode'
import {
  AppError,
  isLoopbackEndpoint,
  parseServerOrigin,
  type BackendCandidate,
  type BackendEndpoint,
} from '@dsh-vscode/domain'

/** Validate explicit Desktop launch input without echoing its credentials. */
export function parseDesktopLaunchUrl(value: string): { endpoint: BackendEndpoint; token: string } {
  try {
    if (value.length > 8192 || /[\r\n\0]/u.test(value)) throw new Error('invalid input')
    const url = new URL(value.trim())
    const tokens = url.searchParams.getAll('token')
    if (
      url.pathname !== '/' ||
      url.hash !== '' ||
      tokens.length > 1 ||
      [...url.searchParams.keys()].some((key) => key !== 'token')
    )
      throw new Error('invalid URL')
    const token = tokens[0] ?? ''
    url.search = ''
    const endpoint = parseServerOrigin(url.toString())
    if (
      endpoint === undefined ||
      !isLoopbackEndpoint(endpoint) ||
      token.length > 4096 ||
      /[\r\n\0]/u.test(token)
    )
      throw new Error('invalid endpoint')
    return { endpoint, token }
  } catch {
    throw new AppError({
      code: 'INVALID_CONFIGURATION',
      message:
        'Paste the local address from Harness → VS Code connection or Desktop → Browser access. Only loopback HTTP(S) URLs are accepted.',
      retryable: false,
    })
  }
}

export interface ConnectDesktopDependencies {
  readonly window: Pick<typeof vscode.window, 'showInputBox'>
  readonly discover: (endpoint: BackendEndpoint) => Promise<readonly BackendCandidate[]>
  readonly connect: (endpoint: BackendEndpoint, token: string, version?: string) => Promise<unknown>
}

export async function connectDesktop(dependencies: ConnectDesktopDependencies): Promise<void> {
  const input = await dependencies.window.showInputBox({
    title: 'DSH: Connect to Desktop / 连接桌面端',
    prompt:
      'Harness / DSH Desktop: General settings → VS Code connection → Copy connection address. With connect 0.1.3+, all Desktop modes work without browser access. 在「通用设置 → VS Code 连接」复制地址；connect 0.1.3+ 支持任意桌面模式，无需开启浏览器访问。',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        parseDesktopLaunchUrl(value)
        return undefined
      } catch {
        return 'Paste the local connection address from Harness or DSH Desktop. 请粘贴官方 Harness 或社区桌面端的本机连接地址。'
      }
    },
  })
  if (input === undefined) return
  const { endpoint, token } = parseDesktopLaunchUrl(input)
  const candidates = await dependencies.discover(endpoint)
  const version = candidates.find(
    (candidate) =>
      candidate.endpoint.port === endpoint.port && candidate.runtimeVersionEvidence === 'process-manifest',
  )?.runtimeVersion
  await dependencies.connect(endpoint, token, version)
}

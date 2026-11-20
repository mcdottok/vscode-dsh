import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, VsCodeConfigurationSource } from './configuration-source.js'

describe('DSH connection configuration', () => {
  it('shares an existing host by default and requires an explicit opt-in to start one', () => {
    const read = (values: Record<string, unknown>): ReturnType<VsCodeConfigurationSource['read']> =>
      new VsCodeConfigurationSource({
        getConfiguration: () => ({ get: (key: string, fallback: unknown) => values[key] ?? fallback }),
      } as never).read()

    expect(read({})).toMatchObject({
      connection: { mode: 'attach-only' },
      runtime: { autoStart: false },
    })
    expect(read({ 'connection.mode': 'auto', 'runtime.autoStart': true })).toMatchObject({
      connection: { mode: 'auto' },
      runtime: { autoStart: true },
    })
  })

  it.each(['ssh-remote', 'wsl'] as const)('waits for the first CLI start in %s', (remoteName) => {
    const settings = new VsCodeConfigurationSource(
      {
        getConfiguration: () => ({
          get: (_key: string, fallback: unknown) => fallback,
          inspect: (key: string) => (key === 'connection.mode' ? { defaultValue: 'attach-only' } : undefined),
        }),
      } as never,
      remoteName,
    ).read()

    expect(settings).toMatchObject({
      connection: { mode: 'new-isolated', awaitingCliStart: true },
      runtime: { autoStart: false },
    })
  })

  it.each([
    ['connection.mode', 'attach-only'],
    ['connection.mode', 'custom'],
    ['connection.serverUrl', 'http://127.0.0.1:4310'],
    ['connection.attachPorts', [3080]],
    ['runtime.autoStart', false],
    ['runtime.autoStart', true],
  ] as const)('preserves the existing remote setting %s = %j', (key, value) => {
    const settings = new VsCodeConfigurationSource(
      {
        getConfiguration: () => ({
          get: (name: string, fallback: unknown) => (name === key ? value : fallback),
          inspect: (name: string) => (name === key ? { workspaceValue: value } : undefined),
        }),
      } as never,
      'ssh-remote',
    ).read()

    expect(settings.connection.awaitingCliStart).toBeUndefined()
    expect(settings.connection.mode).toBe(key === 'connection.mode' ? value : 'attach-only')
    expect(settings.runtime.autoStart).toBe(key === 'runtime.autoStart' ? value : false)
  })

  it.each(['globalValue', 'workspaceValue', 'workspaceFolderValue'] as const)(
    'distinguishes explicit ports in %s from the built-in default',
    (scope) => {
      const source = (inspection: unknown): ReturnType<VsCodeConfigurationSource['read']>['connection'] =>
        new VsCodeConfigurationSource({
          getConfiguration: () => ({
            get: (_key: string, fallback: unknown) => fallback,
            inspect: () => inspection,
          }),
        } as never).read().connection
      expect(source({ defaultValue: [3080] }).attachPortsConfigured).toBeUndefined()
      expect(source({ defaultValue: [3080], [scope]: [3080] }).attachPortsConfigured).toBe(true)
    },
  )
  it('reads custom mode and normalizes a server endpoint', () => {
    const source = new VsCodeConfigurationSource({
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          ({
            'connection.mode': 'custom',
            'connection.serverUrl': 'http://localhost:4310/',
          })[key] ?? fallback,
      }),
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    } as never)

    expect(source.read().connection).toMatchObject({
      mode: 'custom',
      serverUrl: 'http://localhost:4310',
    })
  })

  it('accepts remote and https endpoints and derives default ports', () => {
    expect(normalizeServerUrl('http://192.168.1.10:4310')).toBe('http://192.168.1.10:4310')
    expect(normalizeServerUrl('https://dsh.example.com')).toBe('https://dsh.example.com:443')
    expect(normalizeServerUrl('http://dsh.example.com/')).toBe('http://dsh.example.com:80')
  })

  it('rejects non-http(s) URLs and URLs with paths, credentials, or queries', () => {
    expect(() => normalizeServerUrl('ftp://127.0.0.1:4310')).toThrowError(
      'Invalid DSH setting connection.serverUrl',
    )
    expect(() => normalizeServerUrl('http://127.0.0.1:4310/v1')).toThrowError(
      'Invalid DSH setting connection.serverUrl',
    )
    expect(() => normalizeServerUrl('http://127.0.0.1:99999')).toThrowError(
      'Invalid DSH setting connection.serverUrl',
    )
    expect(() => normalizeServerUrl('http://127.0.0.1:4310?token=x')).toThrowError(
      'Invalid DSH setting connection.serverUrl',
    )
  })
})

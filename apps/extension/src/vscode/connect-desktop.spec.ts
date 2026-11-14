import { describe, expect, it, vi } from 'vitest'
import { connectDesktop, parseDesktopLaunchUrl } from './connect-desktop.js'

describe('connect to Desktop', () => {
  it('separates a launch token from the origin before configuration', async () => {
    const input = vi.fn(() => Promise.resolve('http://127.0.0.1:43120/?token=fixture-desktop-token'))
    const connect = vi.fn(() => Promise.resolve(undefined))
    await connectDesktop({
      window: { showInputBox: input },
      connect,
    })
    expect(input).toHaveBeenCalledWith(expect.objectContaining({ password: true }))
    expect(connect).toHaveBeenCalledExactlyOnceWith(
      { host: '127.0.0.1', port: 43120, baseUrl: 'http://127.0.0.1:43120' },
      'fixture-desktop-token',
    )
  })

  it.each([
    'http://example.com:43120/?token=private-value',
    'http://user:private-value@127.0.0.1:43120/',
    'http://127.0.0.1:43120/api?token=private-value',
    'http://127.0.0.1:43120/?token=one&token=private-value',
    'http://127.0.0.1:43120/?other=private-value',
    'http://127.0.0.1:43120/?token=private-value%0A',
    'not-a-url-private-value',
  ])('rejects unsupported URLs with a redacted error: %s', (url) => {
    expect(() => parseDesktopLaunchUrl(url)).toThrow('Only loopback HTTP(S) URLs are accepted')
    try {
      parseDesktopLaunchUrl(url)
    } catch (error) {
      expect(String(error)).not.toContain('private-value')
    }
  })

  it('cancelled native input performs no authorization or configuration', async () => {
    const connect = vi.fn(() => Promise.resolve(undefined))
    await connectDesktop({
      window: { showInputBox: vi.fn(() => Promise.resolve(undefined)) },
      connect,
    })
    expect(connect).not.toHaveBeenCalled()
  })

  it('accepts a loopback address without a launch token', async () => {
    const connect = vi.fn(() => Promise.resolve(undefined))
    await connectDesktop({
      window: { showInputBox: vi.fn(() => Promise.resolve('http://localhost:43120/')) },
      connect,
    })
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ port: 43120 }), '')
  })
})

import { access } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { advertisesNoOpen, probeWebNoOpen } from './web-launch-probe.js'

describe('DSH web launch option probe', () => {
  it.each([
    ['Options:\n  --no-open       do not open the browser\n', true],
    ['Options:\n  -q, --no-open   do not open the browser\n', true],
    ['Examples:\n  dsh web --no-open\n', false],
    ['Options:\n  --no-open-other flag\n', false],
    ['Options:\n  --host <host>\n', false],
  ])('recognizes actual option declarations in help output', (help, expected) => {
    expect(advertisesNoOpen(help)).toBe(expected)
  })

  it('cleans the isolated profile after reading a supported option', async () => {
    let probeDirectory = ''
    const result = await probeWebNoOpen(async (directory) => {
      probeDirectory = directory
      await expect(access(directory)).resolves.toBeUndefined()
      return { stdout: 'Options:\n  --no-open       do not open the browser\n', stderr: '' }
    }, new AbortController().signal)

    expect(result).toBe(true)
    await expect(access(probeDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('falls back if help fails and still cleans the isolated profile', async () => {
    let probeDirectory = ''
    const result = await probeWebNoOpen((directory) => {
      probeDirectory = directory
      return Promise.reject(new Error('CLI help unavailable'))
    }, new AbortController().signal)

    expect(result).toBe(false)
    await expect(access(probeDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves cancellation instead of treating it as an unsupported option', async () => {
    const controller = new AbortController()
    const result = probeWebNoOpen(() => {
      controller.abort()
      return Promise.reject(new Error('probe aborted'))
    }, controller.signal)

    await expect(result).rejects.toThrow('probe aborted')
  })
})

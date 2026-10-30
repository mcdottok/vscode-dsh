import { describe, expect, it } from 'vitest'

import { isKnownDshVersion } from '../src/contracts.js'
import { managedWebArguments } from '../src/launch-contract.js'

describe('managed Web Profile launch contract', () => {
  it.each([
    ['0.0.1-rc.1', false],
    ['0.0.1-rc.2', false],
    ['0.0.1-rc.5', false],
    ['0.1.0-rc.2', false],
    ['0.1.0-rc.3', false],
    ['0.1.0-rc.6', false],
    ['0.1.0-rc.7', false],
    ['0.1.0-rc.8', true],
    ['0.1.1-rc.1', true],
    ['0.1.1-rc.2', true],
    ['0.1.2-rc.1', true],
    ['0.1.2-alpha.1', true],
    ['0.1.2-alpha.2', true],
    ['0.1.2-alpha.3', true],
    ['0.1.2-alpha.4', true],
    ['0.1.2-alpha.5', true],
    ['0.1.3-alpha.1', true],
    ['0.1.3-alpha.2', true],
    ['0.1.5-alpha.1', true],
    ['0.1.5-alpha.2', true],
    ['0.1.5-rc.1', true],
    ['0.1.5-rc.2', true],
    ['0.1.5-rc.3', true],
    ['0.1.7-alpha.1', true],
    ['0.1.7-alpha.2', true],
    ['0.1.7-rc.1', true],
    ['0.1.7-rc.2', true],
    ['0.2.0-rc.1', true],
    ['0.2.0-rc.2', true],
    ['0.2.1-alpha.1', true],
    ['0.2.1-alpha.2', true],
    ['0.2.1-rc.2', true],
    ['0.2.1-rc.3', true],
    ['0.2.1-rc.4', true],
    ['0.2.1-rc.5', true],
    ['0.2.1-rc.6', false],
    ['0.1.0-rc.99', false],
  ])('uses --no-open only for verified CLI versions: %s', (version, noOpen) => {
    const args = managedWebArguments(version, 4317)

    expect(args).toContain('--profile')
    expect(args).toContain('--host')
    expect(args).toContain('--port')
    expect(args.includes('--no-open')).toBe(noOpen)
  })

  it('normalizes a version label before selecting a versioned flag', () => {
    expect(managedWebArguments('DeepSeek Harness 0.1.0-rc.8', 0)).toContain('--no-open')
    expect(managedWebArguments('DeepSeek Harness 0.2.1-rc.5', 0)).toContain('--no-open')
    expect(managedWebArguments('future-development-build', 0)).not.toContain('--no-open')
  })

  it.each(['0.2.1-rc.4', '0.2.1-rc.5'])(
    'verifies the %s launch flag without claiming an exact protocol adapter',
    (version) => {
      expect(managedWebArguments(version, 4317)).toEqual([
        '--profile',
        'web',
        '--no-open',
        '--host',
        '127.0.0.1',
        '--port',
        '4317',
      ])
      expect(isKnownDshVersion(version)).toBe(false)
    },
  )
})

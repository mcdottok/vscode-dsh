import { isKnownDshVersion, normalizeDshVersion } from './contracts.js'

/**
 * Early DSH Web Profiles that predate the `--no-open` option.
 *
 * Every later known Web Profile gets `--no-open` by default. Other versions
 * stay out until their CLI contract is verified, because an optional flag must
 * never be allowed to prevent the managed process from starting.
 */
const WEB_NO_OPEN_UNSUPPORTED_VERSIONS = new Set([
  '0.0.1-rc.1',
  '0.0.1-rc.2',
  '0.0.1-rc.5',
  '0.1.0-rc.2',
  '0.1.0-rc.3',
  '0.1.0-rc.6',
  '0.1.0-rc.7',
])

/**
 * CLI flags can be verified independently of the broader protocol adapter.
 * rc.4: upstream dsh-v0.2.1-rc.4 web-app/src/startup.ts.
 * rc.5: upstream dsh-v0.2.1-rc.5 web-app README and installed web-app startup.
 */
const WEB_NO_OPEN_VERIFIED_UNADAPTED_VERSIONS = new Set(['0.2.1-rc.4', '0.2.1-rc.5'])

/**
 * The port a DSH Web Profile serves on when no port was chosen.
 *
 * Discovery offers it as a `default-port` candidate, and anything deciding
 * "is an instance I do not own already running?" reads it from here instead of
 * repeating the literal.
 */
export const DEFAULT_DSH_WEB_PORT = 3_080

/**
 * Build the managed Web Profile argument vector for one DSH CLI version.
 *
 * The profile/host/port flags are the common launch contract. `--no-open` is
 * the default for every known release after the early Web Profiles above, and
 * for versions whose CLI flag was separately verified. Other unknown versions
 * remain conservative until their CLI contract is verified.
 */
export function managedWebArguments(version: string, port: number): readonly string[] {
  const normalizedVersion = normalizeDshVersion(version)
  const useNoOpen =
    normalizedVersion !== undefined &&
    (isKnownDshVersion(normalizedVersion) ||
      WEB_NO_OPEN_VERIFIED_UNADAPTED_VERSIONS.has(normalizedVersion)) &&
    !WEB_NO_OPEN_UNSUPPORTED_VERSIONS.has(normalizedVersion)
  return [
    '--profile',
    'web',
    ...(useNoOpen ? ['--no-open'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ]
}

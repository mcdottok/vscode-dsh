import { isDshPackageVersion } from '../../contracts.js'

/** Bounded admission policy, including prereleases; not a claim of exact test coverage. */
export const RC212_COMPATIBILITY_RANGE = '>=0.2.1-rc.2 <0.3.0-0'

export function acceptsRc212CompatibilityVersion(version: string): boolean {
  if (!isDshPackageVersion(version)) return false
  const [release] = version.split('+')
  const [core, ...suffix] = release!.split('-')
  const [major, minor, patch] = core!.split('.')
  if (major !== '0' || minor !== '2' || BigInt(patch!) < 1n) return false
  if (BigInt(patch!) > 1n || suffix.length === 0) return true
  const prerelease = suffix.join('-').split('.')
  // Compare the prerelease against rc.2 using SemVer identifier precedence.
  for (const [index, floor] of ['rc', '2'].entries()) {
    const value = prerelease[index]
    if (value === undefined) return false
    if (value === floor) continue
    const numeric = /^\d+$/u.test(value)
    const floorNumeric = /^\d+$/u.test(floor)
    if (numeric && floorNumeric) return BigInt(value) > BigInt(floor)
    if (numeric !== floorNumeric) return !numeric
    return value > floor
  }
  return true
}

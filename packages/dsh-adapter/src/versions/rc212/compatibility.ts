import { isDshPackageVersion } from '../../contracts.js'

/** Bounded admission policy, including prereleases. */
export function acceptsRc212CompatibilityVersion(version: string): boolean {
  return acceptsModernCompatibilityVersion(version, '1', '2') && !acceptsRc223CompatibilityVersion(version)
}

export function acceptsRc223CompatibilityVersion(version: string): boolean {
  return acceptsModernCompatibilityVersion(version, '2', '2')
}

function acceptsModernCompatibilityVersion(
  version: string,
  minimumPatch: string,
  minimumRc: string,
): boolean {
  if (!isDshPackageVersion(version)) return false
  const [release] = version.split('+')
  const [core, ...suffix] = release!.split('-')
  const [major, minor, patch] = core!.split('.')
  if (major !== '0' || minor !== '2' || BigInt(patch!) < BigInt(minimumPatch)) return false
  if (BigInt(patch!) > BigInt(minimumPatch) || suffix.length === 0) return true
  const prerelease = suffix.join('-').split('.')
  // Compare the prerelease against rc.2 using SemVer identifier precedence.
  for (const [index, floor] of ['rc', minimumRc].entries()) {
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

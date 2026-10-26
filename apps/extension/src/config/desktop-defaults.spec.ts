import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTENSION_ID, VIEW_CONTAINER_ID, VIEW_ID } from '../constants.js'

interface Manifest {
  readonly publisher: string
  readonly name: string
  readonly displayName: string
  readonly contributes: {
    readonly viewsContainers: { readonly secondarySidebar: readonly unknown[] }
    readonly views: Readonly<Record<string, readonly unknown[]>>
    readonly configuration: { readonly properties: Readonly<Record<string, { readonly default: unknown }>> }
  }
}
interface Launch {
  readonly configurations: readonly { readonly env?: Readonly<Record<string, string>> }[]
}
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as Manifest
const launch = JSON.parse(
  readFileSync(new URL('../../../../.vscode/launch.json', import.meta.url), 'utf8'),
) as Launch

describe('desktop sharing defaults', () => {
  it('registers the local DSH entry beside other secondary-sidebar containers', () => {
    expect(`${manifest.publisher}.${manifest.name}`).toBe(EXTENSION_ID)
    expect(manifest.displayName).toBe('DSH')
    expect(manifest.contributes.viewsContainers.secondarySidebar).toContainEqual({
      id: VIEW_CONTAINER_ID,
      title: 'DSH',
      icon: 'resources/dsh.svg',
    })
    expect(manifest.contributes.views[VIEW_CONTAINER_ID]).toContainEqual(
      expect.objectContaining({ id: VIEW_ID, type: 'webview', visibility: 'visible' }),
    )
  })

  it('keeps installed and F5 builds attached to the existing desktop host', () => {
    const settings = manifest.contributes.configuration.properties
    expect(settings['dsh.connection.mode']?.default).toBe('attach-only')
    expect(settings['dsh.runtime.autoStart']?.default).toBe(false)
    for (const configuration of launch.configurations)
      expect(configuration.env?.DSH_VSCODE_DEV_MANAGED_RUNTIME).not.toBe('1')
  })
})

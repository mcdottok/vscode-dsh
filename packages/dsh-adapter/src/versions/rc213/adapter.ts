import type { VersionAdapterIdentity } from '../../adapter-base.js'
import { Rc212VersionAdapter } from '../rc212/adapter.js'

/** dsh-v0.2.1-rc.3 / 1f81c047fc48fa190a683e469daa699857e9afe8.
 * The release changes only Web/Electron client UI packages, analytics and the
 * upstream model listing; consumed Remote, Gateway, Session V4, tools and
 * account wire contracts remain identical to rc.2, so this entry inherits that
 * implementation and differs only in its exact identity.
 */
export class Rc213VersionAdapter extends Rc212VersionAdapter {
  public override supportsCompatibilityVersion(_version: string): boolean {
    return false
  }

  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.2.1-rc.3',
    supportedVersion: '0.2.1-rc.3',
    protocolVersion: 'rc213',
    compatibilityPriority: 340,
    fallback: false,
  }
}

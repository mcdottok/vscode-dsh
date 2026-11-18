import type { VersionAdapterIdentity } from '../../adapter-base.js'
import { Rc223VersionAdapter } from '../rc223/adapter.js'

/** dsh-v0.2.2-rc.4 / 3f321d32bfe382212a8ed8785c1d47a5a300aa23.
 * Provider refusals use the existing V4 assistant/attempt and turn/end events.
 */
export class Rc224VersionAdapter extends Rc223VersionAdapter {
  public override supportsCompatibilityVersion(_version: string): boolean {
    return false
  }

  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.2.2-rc.4',
    supportedVersion: '0.2.2-rc.4',
    protocolVersion: 'rc224',
    compatibilityPriority: 390,
    fallback: false,
  }
}

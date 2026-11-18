import type { VersionAdapterIdentity } from '../../adapter-base.js'
import { Rc224VersionAdapter } from '../rc224/adapter.js'

/** dsh-v0.2.2-rc.5 / 9c2670d3bce5275e0d1610272958121af87787bb.
 * Search provider selection changes inside DSH; consumed wire shapes are unchanged.
 */
export class Rc225VersionAdapter extends Rc224VersionAdapter {
  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.2.2-rc.5',
    supportedVersion: '0.2.2-rc.5',
    protocolVersion: 'rc225',
    compatibilityPriority: 400,
    fallback: false,
  }
}

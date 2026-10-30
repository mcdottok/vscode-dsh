import type { VersionAdapterIdentity } from '../../adapter-base.js'
import { Rc213VersionAdapter } from '../rc213/adapter.js'

/** dsh-v0.2.1-rc.5 / b830ec950faba0a46dda564be3e2d854afed94f1.
 * The rc.4 package audit retained the rc.3 wire; rc.5 changes only Web client
 * reasoning presentation and package versions. Consumed server contracts
 * remain unchanged, so this entry inherits the verified rc.3 implementation.
 */
export class Rc215VersionAdapter extends Rc213VersionAdapter {
  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.2.1-rc.5',
    supportedVersion: '0.2.1-rc.5',
    protocolVersion: 'rc215',
    compatibilityPriority: 350,
    fallback: false,
  }
}

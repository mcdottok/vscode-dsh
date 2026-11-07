import type * as vscode from 'vscode'
import type { WebviewSurface, WebviewSurfaceKind } from './webview-surface.js'

export type WebviewDeliveryFailure = (
  code:
    | 'host-envelope-rejected'
    | 'surface-missing'
    | 'surface-not-ready'
    | 'vscode-post-rejected'
    | 'vscode-post-error',
  surfaceKind?: WebviewSurfaceKind,
) => void

/**
 * Every live chat Webview. The Host owns exactly one sidebar surface and zero
 * or more editor surfaces; `post` broadcasts while `postTo` targets the surface
 * that owns a request, so a response can never settle the wrong Webview.
 */
export class WebviewSurfaceRegistry implements vscode.Disposable {
  private readonly surfaces = new Map<string, WebviewSurface>()

  public register(surface: WebviewSurface): void {
    this.surfaces.set(surface.surfaceId, surface)
  }

  /** Remove a surface from routing without disposing it (its owner does that). */
  public unregister(surfaceId: string): void {
    this.surfaces.delete(surfaceId)
  }

  public get(surfaceId: string): WebviewSurface | undefined {
    return this.surfaces.get(surfaceId)
  }

  public list(): readonly WebviewSurface[] {
    return [...this.surfaces.values()]
  }

  /**
   * The surface a user-initiated action should target: the most recently
   * registered visible one, falling back to the most recently registered.
   */
  public get active(): WebviewSurface | undefined {
    const all = [...this.surfaces.values()]
    return all.filter((surface) => surface.visible).at(-1) ?? all.at(-1)
  }

  public get editorCount(): number {
    let count = 0
    for (const surface of this.surfaces.values()) if (surface.kind === 'editor') count += 1
    return count
  }

  public isEmpty(): boolean {
    return this.surfaces.size === 0
  }

  /** Broadcast: used for events that every surface filters for itself. */
  public async post(message: unknown): Promise<boolean> {
    const targets = [...this.surfaces.values()]
    if (targets.length === 0) return false
    const results = await Promise.all(
      targets.map((surface) =>
        Promise.resolve()
          .then(() => surface.postMessage(message))
          .then(
            (delivered) => delivered,
            () => false,
          ),
      ),
    )
    return results.some(Boolean)
  }

  public async postTo(
    surfaceId: string,
    message: unknown,
    onFailure?: WebviewDeliveryFailure,
  ): Promise<boolean> {
    const surface = this.surfaces.get(surfaceId)
    if (surface === undefined) {
      onFailure?.('surface-missing')
      return false
    }
    const readyAtPost = onFailure === undefined || surface.isReady
    let delivered: boolean
    try {
      delivered = await surface.postMessage(message)
    } catch {
      onFailure?.('vscode-post-error', surface.kind)
      return false
    }
    if (!delivered) onFailure?.(readyAtPost ? 'vscode-post-rejected' : 'surface-not-ready', surface.kind)
    return delivered
  }

  public dispose(): void {
    const surfaces = [...this.surfaces.values()]
    this.surfaces.clear()
    for (const surface of surfaces) surface.dispose()
  }
}

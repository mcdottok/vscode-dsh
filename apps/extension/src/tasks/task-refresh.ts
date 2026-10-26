/** One authoritative task read in flight and one trailing refresh intent. */
export class TaskRefresh {
  private dirty = false
  private running = false
  private stopped = false

  public constructor(private readonly read: () => Promise<void>) {}

  public request(): void {
    if (this.stopped) return
    this.dirty = true
    if (this.running) return
    this.running = true
    void Promise.resolve().then(() => this.drain())
  }

  public dispose(): void {
    this.stopped = true
    this.dirty = false
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty && !this.stopped) {
        this.dirty = false
        try {
          await this.read()
        } catch {
          /* A later state change can retry. */
        }
      }
    } finally {
      this.running = false
      if (this.dirty && !this.stopped) this.request()
    }
  }
}

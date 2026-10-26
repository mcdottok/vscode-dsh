/** Debounces selection changes without revealing chat or submitting a prompt. */
export class AutomaticSelectionContext {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: AbortController | undefined
  private capturedKey: string | undefined
  private disposed = false

  public constructor(
    private readonly dependencies: {
      readonly selectionKey: () => string | undefined
      readonly capture: (signal: AbortSignal) => Promise<void>
      readonly onError: () => void
    },
  ) {}

  public schedule(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.pending?.abort()
    this.timer = undefined
    const key = this.dependencies.selectionKey()
    if (key === undefined || key === this.capturedKey) return
    const pending = new AbortController()
    this.pending = pending
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (pending.signal.aborted || this.dependencies.selectionKey() !== key) return
      void this.dependencies.capture(pending.signal).then(
        () => {
          if (!pending.signal.aborted) this.capturedKey = key
        },
        () => {
          if (!pending.signal.aborted) this.dependencies.onError()
        },
      )
    }, 300)
  }

  public reset(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.pending?.abort()
    this.capturedKey = undefined
  }

  public dispose(): void {
    this.disposed = true
    this.reset()
  }
}

import { describe, expect, it, vi } from 'vitest'
import { TaskRefresh } from './task-refresh.js'

describe('task state refresh scheduling', () => {
  it('coalesces bursts and keeps only one trailing read behind a slow source', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const read = vi.fn<() => Promise<void>>().mockReturnValueOnce(gate).mockResolvedValue(undefined)
    const refresh = new TaskRefresh(read)
    for (let i = 0; i < 1000; i++) refresh.request()
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 1000; i++) refresh.request()
    expect(read).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    refresh.dispose()
  })

  it('does not start a queued read after disposal', async () => {
    const read = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const refresh = new TaskRefresh(read)
    refresh.request()
    refresh.dispose()
    await Promise.resolve()
    expect(read).not.toHaveBeenCalled()
  })

  it('retries after an error without retaining failed work', async () => {
    const read = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('fixture'))
      .mockResolvedValue(undefined)
    const refresh = new TaskRefresh(read)
    refresh.request()
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    refresh.request()
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    refresh.dispose()
  })
})

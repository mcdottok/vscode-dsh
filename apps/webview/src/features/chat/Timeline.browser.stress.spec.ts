// @vitest-environment node
import { expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const browser = [
  process.env.DSH_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => path !== undefined && existsSync(path))
const root = resolve(import.meta.dirname, '../../..')

// Real CSS overflow is absent from jsdom. Run this with the stress suite and
// Chrome/Edge installed (or DSH_TEST_BROWSER pointing to a Chromium executable).
it.skipIf(browser === undefined)(
  'keeps nested work log overflow inside its scroller in all four modes',
  { tags: ['stress'], timeout: 60_000 },
  async () => {
    const fixture = resolve(root, `__work_log_${process.pid}.html`)
    const cache = resolve(root, '../../node_modules/.cache')
    const profile = await mkdtemp(resolve(cache, 'work-log-browser-'))
    if (!profile.startsWith(cache + sep)) throw new Error('Browser profile escaped test cache')
    const html = await readFile(resolve(import.meta.dirname, 'work-log-browser-fixture.html'), 'utf8')
    await writeFile(fixture, html)
    const server = await createServer({
      root,
      configFile: resolve(root, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'error',
    })
    let child: ReturnType<typeof spawn> | undefined
    let socket: WebSocket | undefined
    const pending = new Map<
      number,
      { resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void }
    >()
    try {
      await server.listen()
      const address = server.httpServer!.address()
      if (address === null || typeof address === 'string') throw new Error('No test server port')
      const origin = `http://127.0.0.1:${address.port}`
      child = spawn(
        browser!,
        [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--remote-debugging-port=0',
          '--remote-debugging-address=127.0.0.1',
          `--user-data-dir=${profile}`,
          '--window-size=780,1100',
          'about:blank',
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      )
      const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
        let stderr = ''
        const timer = setTimeout(
          () => reject(new Error(`Browser did not start: ${stderr.slice(-1000)}`)),
          10_000,
        )
        child!.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child!.stderr!.on('data', (data: Buffer) => {
          stderr += data.toString()
          const match = /DevTools listening on (ws:\/\/\S+)/u.exec(stderr)
          if (match !== null) {
            clearTimeout(timer)
            resolveEndpoint(match[1]!)
          }
        })
      })
      const host = new URL(endpoint).host
      const targets = (await (await fetch(`http://${host}/json/list`)).json()) as {
        type: string
        webSocketDebuggerUrl: string
      }[]
      socket = new WebSocket(targets.find((target) => target.type === 'page')!.webSocketDebuggerUrl)
      await new Promise<void>((resolveOpen, reject) => {
        socket!.addEventListener('open', () => resolveOpen(), { once: true })
        socket!.addEventListener('error', () => reject(new Error('Debugger connection failed')), {
          once: true,
        })
      })
      let id = 0
      socket.addEventListener('message', (event) => {
        const value = JSON.parse(String(event.data)) as {
          id?: number
          result?: Record<string, unknown>
          error?: unknown
        }
        if (value.id === undefined) return
        const request = pending.get(value.id)
        pending.delete(value.id)
        if (value.error === undefined) request?.resolve(value.result ?? {})
        else request?.reject(new Error(JSON.stringify(value.error)))
      })
      socket.addEventListener('close', () => {
        for (const request of pending.values()) request.reject(new Error('Debugger closed'))
        pending.clear()
      })
      const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
        new Promise((resolveResult, reject) => {
          const requestId = ++id
          pending.set(requestId, { resolve: resolveResult, reject })
          socket!.send(JSON.stringify({ id: requestId, method, params }))
        })
      const evaluate = async (expression: string): Promise<unknown> => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (result.exceptionDetails !== undefined) throw new Error(JSON.stringify(result.exceptionDetails))
        return (result.result as { value?: unknown }).value
      }
      const settle = (): Promise<unknown> =>
        evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const check = async (): Promise<void> => {
        await settle()
        const geometry = (await evaluate(`(() => {
        const viewport = document.querySelector('.dsh-timeline');
        const canvas = document.querySelector('.dsh-timeline__canvas');
        const last = [...document.querySelectorAll('.dsh-timeline__row')].at(-1);
        const visibleEnd = Math.max(canvas.getBoundingClientRect().bottom, last.getBoundingClientRect().bottom) - viewport.getBoundingClientRect().top + viewport.scrollTop;
        const padding = parseFloat(getComputedStyle(viewport).paddingBottom) || 0;
        return { overflow: viewport.scrollHeight - Math.max(viewport.clientHeight, Math.ceil(visibleEnd + padding)), text: last.textContent };
      })()`)) as { overflow: number; text: string }
        expect(geometry.text).toContain('Hello.')
        expect(geometry.overflow).toBeLessThanOrEqual(2)
      }
      for (const mode of ['compact', 'standard', 'detailed', 'verbose']) {
        await send('Page.navigate', { url: `${origin}/__work_log_${process.pid}.html?mode=${mode}` })
        let ready = false
        for (let attempt = 0; attempt < 100 && !ready; attempt++) {
          await delay(50)
          try {
            ready = (await evaluate("Boolean(document.querySelector('.dsh-focused-turn__summary'))")) === true
          } catch {
            /* Navigation retires the previous execution context. */
          }
        }
        expect(ready).toBe(true)
        await check()
        await evaluate("document.querySelector('.dsh-focused-turn__summary').click()")
        await check()
        for (let index = 0; index < 12; index++) {
          await evaluate(
            `(() => { const buttons = [...document.querySelectorAll('.dsh-focused-tools__summary')]; const button = buttons[Math.min(${index} * 3, buttons.length - 1)]; if (button && !button.disabled) button.click(); })()`,
          )
          await check()
        }
        await evaluate("document.querySelector('.dsh-focused-turn__summary').click()")
        await check()
      }
      await send('Browser.close')
    } finally {
      socket?.close()
      child?.kill()
      await server.close()
      await rm(fixture, { force: true })
      // Chromium may release its profile handles shortly after Browser.close.
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)

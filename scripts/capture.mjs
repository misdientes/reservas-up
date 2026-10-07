// Captura de página completa con Microsoft Edge sin ventana vía Chrome DevTools Protocol.
// Sin dependencias (Node 24 trae fetch y WebSocket). Uso:
//   node scripts/capture.mjs <url> <ancho> <salida.png> [--h=<alto>] [--click=<selector>] [--eval=<expresión>]
// Reporta desborde horizontal y errores de consola.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const [url, widthArg, out, ...flags] = process.argv.slice(2)
const width = Number(widthArg)
const click = flags.find((f) => f.startsWith('--click='))?.slice(8)
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9300 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(path.join(tmpdir(), 'edge-cdp-'))

const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    target = list.find((t) => t.type === 'page')
  } catch {}
}
if (!target) throw new Error('Edge no respondió')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text)
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text + ' ' + (msg.params.entry.url ?? ''))
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
})
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
const fixedHeight = Number(flags.find((f) => f.startsWith('--h='))?.slice(4)) || 0
await send('Emulation.setDeviceMetricsOverride', { width, height: fixedHeight || 900, deviceScaleFactor: 1, mobile: width < 768 })
await send('Page.navigate', { url })
await sleep(4500)
if (click) {
  await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(click)})?.click()` })
  await sleep(800)
}
const evalExpr = flags.find((f) => f.startsWith('--eval='))?.slice(7)
if (evalExpr) {
  const r = await send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true })
  console.log('EVAL:', JSON.stringify(r.result.result.value))
}
const metrics = await send('Runtime.evaluate', { expression: 'JSON.stringify({h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth})', returnByValue: true })
const parsed = JSON.parse(metrics.result.result.value)
const w = parsed.w
const h = fixedHeight || parsed.h
// Ventana del alto de la página: así los elementos "sticky" (barra de
// reserva) quedan donde terminarían al final del recorrido, no a media página.
if (!fixedHeight) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: width < 768 })
  await sleep(400)
}
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } })
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log(JSON.stringify({ out, width, scrollWidth: w, height: h, horizontalOverflow: w > width, consoleErrors }))
ws.close(); browser.kill()

// Prueba en un navegador REAL (Edge vía CDP) del procesamiento de fotos del
// panel (src/admin/photos/process.ts), servido por el servidor de desarrollo:
//   npm run dev:localdb   (en otra terminal)
//   node scripts/test-photos.mjs
// 1. Edge genera un JPEG grande (3200×2400, con "ruido" para que pese).
// 2. Node le inserta un EXIF con GPS (mismo generador que vitest).
// 3. Edge lo procesa con processPhoto() y devuelve el resultado.
// 4. Node verifica: sin EXIF ni GPS, lado mayor ≤ 2400 px y < 400 KB.

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SITE = process.argv[2] ?? 'http://localhost:5174'
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9900 + Math.floor(Math.random() * 90)
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'edge-photos-'))}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result.result.value
}

await send('Page.enable')
await send('Page.navigate', { url: `${SITE}/` })
await sleep(4000)

const results = []
const check = (name, expected, actual) => results.push({ name, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) })

// Todo ocurre en el navegador (con las mismas funciones del panel); solo
// vuelve un resumen pequeño.
const out = await evaluate(`(async () => {
  const { processPhoto } = await import('/src/admin/photos/process.ts')
  const { exifInfo } = await import('/src/admin/photos/image-info.ts')
  const { withGps } = await import('/src/admin/photos/exif-fixture.ts')
  // 1. JPEG grande (3200×2400) con textura, generado por el navegador.
  const c = document.createElement('canvas'); c.width = 3200; c.height = 2400
  const x = c.getContext('2d')
  for (let i = 0; i < 400; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',60%,' + (30 + i % 40) + '%)'; x.fillRect((i * 97) % 3200, (i * 53) % 2400, 220, 160) }
  const base = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer())
  // 2. Se le agrega EXIF con GPS.
  const raw = withGps(base)
  const before = exifInfo(raw)
  // 3. Procesamiento del panel.
  const r = await processPhoto(new File([raw], 'foto.jpg', { type: 'image/jpeg' }))
  if (!r.ok) return { error: r.reason }
  const after = exifInfo(new Uint8Array(await r.photo.blob.arrayBuffer()))
  const heic = await processPhoto(new File([new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99,0,0,0,0])], 'IMG_0001.HEIC', { type: '' }))
  return { inBytes: raw.length, before, after, width: r.photo.width, height: r.photo.height, size: r.photo.blob.size, type: r.photo.type, heic: heic.ok ? 'subida' : heic.reason }
})()`)
if (out.error) throw new Error('processPhoto: ' + out.error)

check('El original trae EXIF con GPS', 'true|true', `${out.before?.exif}|${out.before?.gps}`)
check('La foto procesada sale SIN EXIF ni GPS', 'false|false', `${out.after?.exif}|${out.after?.gps}`)
check('Lado mayor ≤ 2400 px (3200×2400 → 2400×1800)', '2400x1800', `${out.width}x${out.height}`)
check('Pesa menos de 400 KB', true, out.size < 400 * 1024)
check('Formato WebP', 'image/webp', out.type)
check('Una foto HEIC no se procesa (mensaje para convertirla)', 'heic', out.heic)

ws.close(); browser.kill()
const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.name.padEnd(width)}  esperado: ${r.expected}  obtenido: ${r.actual}`)
console.log(`\n(original ${Math.round(out.inBytes / 1024)} KB → procesada ${Math.round(out.size / 1024)} KB)`)
const failed = results.filter((r) => !r.ok).length
console.log(`TOTAL ${results.length}  OK ${results.length - failed}  FALLA ${failed}`)
process.exit(failed ? 1 : 0)

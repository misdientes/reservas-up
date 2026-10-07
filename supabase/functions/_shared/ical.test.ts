import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCalendar, fetchCalendar, fold, ICAL_WINDOW_DAYS, isAllowedUrl, parseCalendar, unfold } from './ical.ts'
import { AVAILABILITY_WINDOW_DAYS } from '../../../src/lib/calendar/availability'

const FIXTURES = path.resolve(__dirname, '../../tests/fixtures')
const read = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8')
// "Hoy" fijo para que las pruebas no dependan de la fecha en que corren.
const TODAY = '2026-11-01'
const parse = (name: string) => parseCalendar(read(name), TODAY)
const events = (name: string) => {
  const result = parse(name)
  if (!result.ok) throw new Error(`se esperaba un calendario válido: ${result.error}`)
  return result.events
}

describe('ventana', () => {
  it('es la misma que la del calendario y la función SQL (548 días)', () => {
    expect(ICAL_WINDOW_DAYS).toBe(AVAILABILITY_WINDOW_DAYS)
  })
})

describe('lectura de calendarios', () => {
  it('Airbnb, día completo: DTEND exclusivo = día de salida', () => {
    expect(events('airbnb-dia-completo.ics')).toEqual([
      { uid: '1418fb94e984-ejemplo-a@airbnb.com', start: '2026-11-20', end: '2026-11-23' },
      { uid: '7f3a2c-ejemplo-b@airbnb.com', start: '2026-12-05', end: '2026-12-10' },
    ])
  })

  it('Booking', () => {
    expect(events('booking.ics')).toEqual([{ uid: 'ejemplo-booking-1@booking.com', start: '2026-11-20', end: '2026-11-23' }])
  })

  it('con hora: TZID, UTC y flotante se convierten a la fecha de Chile', () => {
    const byUid = Object.fromEntries(events('google-con-hora-tzid.ics').map((e) => [e.uid, [e.start, e.end]]))
    // Nueva York 15:00 (UTC−5) = 17:00 en Chile, mismo día.
    expect(byUid['ny@google.com']).toEqual(['2026-11-20', '2026-11-22'])
    // Tokio 10:00 del 21 (UTC+9) = 22:00 del 20 en Chile: cruza la medianoche.
    expect(byUid['tokio@google.com']).toEqual(['2026-11-20', '2026-11-22'])
    // 03:00 UTC = 00:00 en Chile (UTC−3); 02:59 UTC = 23:59 del día anterior.
    expect(byUid['utc-0000@google.com']).toEqual(['2026-11-25', '2026-11-27'])
    expect(byUid['utc-2359@google.com']).toEqual(['2026-11-27', '2026-11-29'])
    // Sin zona: se interpreta como hora de Chile.
    expect(byUid['flotante@google.com']).toEqual(['2026-12-01', '2026-12-03'])
    // Evento con hora dentro de un mismo día: bloquea esa noche. El VALARM anidado se ignora.
    expect(byUid['mismo-dia@google.com']).toEqual(['2026-12-05', '2026-12-06'])
  })

  it('cambio de fechas del mismo UID', () => {
    expect(events('cambio-v1.ics')).toEqual([{ uid: 'cambio@test', start: '2026-11-10', end: '2026-11-13' }])
    expect(events('cambio-v2.ics')).toEqual([{ uid: 'cambio@test', start: '2026-11-11', end: '2026-11-15' }])
  })

  it('cancelación: el evento desaparece; un STATUS:CANCELLED no bloquea', () => {
    expect(events('cancelacion-v1.ics').map((e) => e.uid)).toEqual(['queda@test', 'se-cancela@test'])
    expect(events('cancelacion-v2.ics').map((e) => e.uid)).toEqual(['queda@test'])
  })

  it('calendario vacío válido: ok, sin eventos', () => {
    expect(parse('vacio.ics')).toEqual({ ok: true, events: [] })
  })

  it('pasado, que termina hoy, que cruza hoy, lejano y que cruza la ventana', () => {
    // Ventana desde 2026-11-01: hasta 2028-05-02 (exclusivo).
    expect(events('pasado-y-lejano.ics')).toEqual([
      { uid: 'cruza-hoy@test', start: '2026-11-01', end: '2026-11-03' },
      { uid: 'cruza-ventana@test', start: '2028-04-30', end: '2028-05-02' },
    ])
  })

  it('UID duplicado: se une en el rango que cubre ambos', () => {
    expect(events('uid-duplicado.ics')).toEqual([{ uid: 'dup@test', start: '2026-11-10', end: '2026-11-16' }])
  })

  it('líneas plegadas (RFC 5545)', () => {
    expect(events('plegado.ics')[0].uid).toBe('muy-largo-para-ver-el-desdoblado-de-lineas-segun-rfc5545-0123456789abcdef@test')
    expect(unfold('A:uno\r\n dos\r\n\ttres')).toEqual(['A:unodostres'])
  })

  it.each([
    ['corrupto-sin-fin.ics', 'sin END:VCALENDAR'],
    ['corrupto-fecha.ics', 'un VEVENT con fecha imposible (aunque otro esté bien)'],
    ['tzid-desconocido.ics', 'TZID que no existe'],
    ['no-es-calendario.ics', 'respuesta que no es iCal'],
  ])('%s → INVÁLIDO entero (%s): no se aplica nada', (name) => {
    const result = parse(name)
    expect(result.ok).toBe(false)
  })
})

describe('hosts permitidos', () => {
  const ALLOWED = 'airbnb.*,booking.com,google.com'
  it.each([
    ['https://www.airbnb.cl/calendar/ical/123.ics?s=abc', true],
    ['https://www.airbnb.com/calendar/ical/123.ics', true],
    ['https://airbnb.co.uk/calendar/ical/1.ics', true],
    ['https://admin.booking.com/hotel/hoteladmin/ical.html?t=x', true],
    ['https://calendar.google.com/calendar/ical/x/private-y/basic.ics', true],
    ['http://www.airbnb.cl/calendar/ical/123.ics', false], // solo https
    ['https://airbnb.evil.com/x.ics', false],
    ['https://www.airbnb.cl.evil.com/x.ics', false],
    ['https://evilbooking.com/x.ics', false],
    ['https://user:pass@calendar.google.com/x.ics', false],
    ['no es una url', false],
  ])('%s → %s', (url, allowed) => {
    expect(isAllowedUrl(url, ALLOWED)).toBe(allowed)
  })
})

describe('descarga segura', () => {
  const ALLOWED = 'airbnb.*,booking.com,google.com'
  const SECRET_URL = 'https://www.airbnb.cl/calendar/ical/123.ics?s=TOKEN-SECRETO'
  const fakeFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
    ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch

  it('error HTTP → falla (y el error no incluye la URL secreta)', async () => {
    const result = await fetchCalendar(SECRET_URL, ALLOWED, { fetchImpl: fakeFetch(() => new Response('x', { status: 503 })) })
    expect(result).toEqual({ ok: false, error: 'HTTP 503' })
    expect(JSON.stringify(result)).not.toContain('TOKEN-SECRETO')
  })

  it('redirección a un host no permitido → falla', async () => {
    const result = await fetchCalendar(SECRET_URL, ALLOWED, {
      fetchImpl: fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.ics' } })),
    })
    expect(result).toEqual({ ok: false, error: 'Redirección a una dirección no permitida' })
  })

  it('redirección a un host permitido → sigue y descarga', async () => {
    const result = await fetchCalendar(SECRET_URL, ALLOWED, {
      fetchImpl: fakeFetch((url) =>
        url.includes('airbnb.com')
          ? new Response(read('vacio.ics'), { status: 200 })
          : new Response(null, { status: 301, headers: { location: 'https://www.airbnb.com/calendar/ical/123.ics' } }),
      ),
    })
    expect(result.ok).toBe(true)
  })

  it('archivo demasiado grande → falla (por encabezado y por contenido)', async () => {
    const big = 'X'.repeat(3000)
    expect(await fetchCalendar(SECRET_URL, ALLOWED, { maxBytes: 1000, fetchImpl: fakeFetch(() => new Response(big, { status: 200, headers: { 'content-length': '3000' } })) })).toEqual({ ok: false, error: 'Archivo demasiado grande' })
    expect(await fetchCalendar(SECRET_URL, ALLOWED, { maxBytes: 1000, fetchImpl: fakeFetch(() => new Response(big, { status: 200 })) })).toEqual({ ok: false, error: 'Archivo demasiado grande' })
  })

  it('tiempo de espera agotado → falla', async () => {
    const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })))
      })) as typeof fetch
    expect(await fetchCalendar(SECRET_URL, ALLOWED, { timeoutMs: 30, fetchImpl: hang })).toEqual({ ok: false, error: 'Tiempo de espera agotado' })
  })

  it('URL no permitida → no se descarga nada', async () => {
    let called = false
    const result = await fetchCalendar('http://www.airbnb.cl/x.ics', ALLOWED, { fetchImpl: fakeFetch(() => ((called = true), new Response(''))) })
    expect(result).toEqual({ ok: false, error: 'Dirección no permitida' })
    expect(called).toBe(false)
  })
})

describe('exportación', () => {
  const EVENTS = [
    { uid: '6c1f0e2a-0000-4000-8000-000000000001@reservas-up', start_date: '2026-11-20', end_date: '2026-11-23', summary: 'Reservado' },
    { uid: '6c1f0e2a-0000-4000-8000-000000000002@reservas-up', start_date: '2026-12-01', end_date: '2026-12-02', summary: 'No disponible' },
  ]

  it('genera un VCALENDAR válido que el lector vuelve a leer igual', () => {
    const ics = buildCalendar(EVENTS, new Date('2026-11-01T12:00:00Z'))
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(parseCalendar(ics, TODAY)).toEqual({
      ok: true,
      events: EVENTS.map((e) => ({ uid: e.uid, start: e.start_date, end: e.end_date })),
    })
  })

  it('sin datos personales: solo "Reservado"/"No disponible" y ningún email', () => {
    const ics = buildCalendar(EVENTS)
    const summaries = ics.split('\r\n').filter((l) => l.startsWith('SUMMARY:'))
    expect(new Set(summaries)).toEqual(new Set(['SUMMARY:Reservado', 'SUMMARY:No disponible']))
    // El único "@" permitido es el de los UID propios.
    expect(ics.replace(/[0-9a-f-]+@reservas-up/g, '')).not.toMatch(/@/)
  })

  it('pliega líneas largas a 75 octetos sin romper caracteres', () => {
    const line = 'SUMMARY:' + 'ñ'.repeat(60)
    const folded = fold(line)
    for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    expect(unfold(folded)).toEqual([line])
  })
})

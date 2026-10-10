import { describe, expect, it } from 'vitest'
import { exifInfo, fitWithin, isHeic } from './image-info'
import { jpegWithGps, minimalJpeg } from './exif-fixture'

describe('fotos: HEIC', () => {
  const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...[...`ftyp${brand}`].map((c) => c.charCodeAt(0))])

  it('detecta HEIC/HEIF por tipo MIME', () => {
    expect(isHeic('image/heic', new Uint8Array())).toBe(true)
    expect(isHeic('image/heif', new Uint8Array())).toBe(true)
  })

  it('detecta por la firma aunque el MIME venga vacío o mal (ftypheic / ftypmif1)', () => {
    expect(isHeic('', ftyp('heic'))).toBe(true)
    expect(isHeic('application/octet-stream', ftyp('mif1'))).toBe(true)
    expect(isHeic('image/jpeg', ftyp('heix'))).toBe(true)
  })

  it('no confunde un JPEG ni un MP4', () => {
    expect(isHeic('image/jpeg', minimalJpeg())).toBe(false)
    expect(isHeic('', ftyp('isom'))).toBe(false)
  })
})

describe('fotos: tamaño', () => {
  it('lado mayor 2400 px como máximo, sin agrandar', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2400, height: 1800 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1800, height: 2400 })
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 })
  })
})

describe('fotos: EXIF', () => {
  it('detecta EXIF con GPS en un JPEG', () => {
    expect(exifInfo(jpegWithGps())).toEqual({ exif: true, gps: true })
  })

  it('un JPEG limpio no tiene EXIF', () => {
    expect(exifInfo(minimalJpeg())).toEqual({ exif: false, gps: false })
  })
})

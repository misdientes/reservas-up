// Datos de prueba: inserta un segmento EXIF con GPS (APP1, TIFF little
// endian: IFD0 con la etiqueta GPSInfo 0x8825 → IFD GPS con latitud "S")
// en un JPEG. Lo usan image-info.test.ts y scripts/test-photos.mjs.

function exifSegment(): Uint8Array {
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", 42, IFD0 en 8
    0x01, 0x00, // IFD0: 1 entrada
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, // GPSInfo (LONG) → 26
    0x00, 0x00, 0x00, 0x00, // sin IFD siguiente
    0x01, 0x00, // IFD GPS: 1 entrada
    0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x53, 0x00, 0x00, 0x00, // GPSLatitudeRef = "S"
    0x00, 0x00, 0x00, 0x00,
  ]
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff] // "Exif\0\0"
  const length = payload.length + 2
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...payload])
}

// JPEG + EXIF con GPS, insertado justo después de SOI.
export function withGps(jpeg: Uint8Array): Uint8Array {
  const segment = exifSegment()
  const out = new Uint8Array(jpeg.length + segment.length)
  out.set(jpeg.slice(0, 2), 0)
  out.set(segment, 2)
  out.set(jpeg.slice(2), 2 + segment.length)
  return out
}

// Estructura mínima (SOI + EOI): suficiente para el lector de EXIF.
export function minimalJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
}

export function jpegWithGps(): Uint8Array {
  return withGps(minimalJpeg())
}

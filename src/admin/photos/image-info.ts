// Funciones puras sobre imágenes (probadas en image-info.test.ts).

// HEIC/HEIF (fotos del iPhone): los navegadores no las decodifican de forma
// confiable, así que se detectan y no se suben. Por tipo MIME y por la firma
// del contenedor ISO-BMFF: bytes 4..11 = "ftyp" + marca (heic, heix, mif1…).
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']

export function isHeic(mimeType: string, head: Uint8Array): boolean {
  if (/^image\/hei[cf](-sequence)?$/i.test(mimeType)) return true
  if (head.length < 12) return false
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  return ascii(4, 8) === 'ftyp' && HEIC_BRANDS.includes(ascii(8, 12).toLowerCase())
}

// Lado mayor como máximo `max` px, sin agrandar.
export function fitWithin(width: number, height: number, max = 2400): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// Calidades a probar hasta quedar bajo el objetivo (~400 KB).
export const QUALITY_STEPS = [0.8, 0.72, 0.66, 0.6] as const
export const TARGET_BYTES = 400 * 1024

// ¿Trae metadatos EXIF (y GPS)? JPEG: segmento APP1 "Exif"; GPS = etiqueta
// 0x8825 en el IFD0. WebP: fragmento "EXIF". Se usa para verificar que la
// foto procesada sale limpia.
export function exifInfo(bytes: Uint8Array): { exif: boolean; gps: boolean } {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegExif(bytes)
  const tag = (i: number) => String.fromCharCode(...bytes.slice(i, i + 4))
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    for (let i = 12; i + 8 <= bytes.length; ) {
      const size = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)
      if (tag(i) === 'EXIF') return { exif: true, gps: true } // en WebP se trata como posible GPS
      i += 8 + size + (size % 2)
    }
  }
  return { exif: false, gps: false }
}

function jpegExif(b: Uint8Array): { exif: boolean; gps: boolean } {
  let i = 2
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]
    if (marker === 0xda || marker === 0xd9) break // inicio de imagen / fin
    const length = (b[i + 2] << 8) | b[i + 3]
    if (marker === 0xe1 && String.fromCharCode(...b.slice(i + 4, i + 8)) === 'Exif') {
      return { exif: true, gps: tiffHasGps(b.slice(i + 10, i + 2 + length)) }
    }
    i += 2 + length
  }
  return { exif: false, gps: false }
}

function tiffHasGps(t: Uint8Array): boolean {
  if (t.length < 8) return false
  const le = t[0] === 0x49 // "II" = little endian
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1])
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 2 ** 24 : t[o] * 2 ** 24 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]))
  const ifd = u32(4)
  if (ifd + 2 > t.length) return false
  const count = u16(ifd)
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12
    if (entry + 12 > t.length) break
    if (u16(entry) === 0x8825) return true
  }
  return false
}

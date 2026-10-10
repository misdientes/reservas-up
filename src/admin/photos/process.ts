import { QUALITY_STEPS, TARGET_BYTES, fitWithin, isHeic } from './image-info'

// Prepara una foto ANTES de subirla (en el navegador del admin):
//  1. rechaza HEIC/HEIF con un mensaje claro;
//  2. corrige la orientación (createImageBitmap con imageOrientation);
//  3. redimensiona (lado mayor ≤ 2400 px);
//  4. vuelve a codificar en WebP (JPEG si el navegador no sabe WebP),
//     bajando la calidad hasta quedar bajo ~400 KB.
// Re-codificar desde un canvas elimina TODOS los metadatos (EXIF, GPS).
// Se prueba en un navegador real: scripts/test-photos.mjs.

export type ProcessedPhoto = { blob: Blob; width: number; height: number; extension: 'webp' | 'jpg'; type: string }
export type ProcessResult = { ok: true; photo: ProcessedPhoto } | { ok: false; reason: 'heic' | 'not_image' | 'decode_failed' }

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function processPhoto(file: Blob & { type: string }): Promise<ProcessResult> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (isHeic(file.type, head)) return { ok: false, reason: 'heic' }
  if (file.type && !file.type.startsWith('image/')) return { ok: false, reason: 'not_image' }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return { ok: false, reason: 'decode_failed' }
  }
  const size = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, reason: 'decode_failed' }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()

  // ¿El navegador codifica WebP? (Si no, toBlob devuelve PNG.)
  const probe = await toBlob(canvas, 'image/webp', 0.8)
  const type = probe?.type === 'image/webp' ? 'image/webp' : 'image/jpeg'

  let blob: Blob | null = type === 'image/webp' ? probe : null
  for (const quality of QUALITY_STEPS) {
    if (blob && quality === QUALITY_STEPS[0] && blob.size <= TARGET_BYTES) break
    blob = await toBlob(canvas, type, quality)
    if (blob && blob.size <= TARGET_BYTES) break
  }
  if (!blob) return { ok: false, reason: 'decode_failed' }
  return { ok: true, photo: { blob, width: size.width, height: size.height, extension: type === 'image/webp' ? 'webp' : 'jpg', type } }
}

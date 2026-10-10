import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import { AlertIcon } from '../../components/icons'
import { PHOTO_BUCKET, errorMessage, photoUrl, type PhotoRow, type PropertyRow } from '../api'
import { processPhoto, type ProcessedPhoto } from '../photos/process'
import { ea } from '../../lib/i18n/es-admin'

// Fotos: se procesan en el navegador (sin EXIF/GPS, ≤ 2400 px, WebP < ~400 KB)
// y se suben a property-photos/<id de la propiedad>/<uuid>.<ext> (nombre no
// adivinable). El texto alternativo es obligatorio. En una propiedad
// publicada la base no permite quedar con menos de 5 fotos ni sin portada.

interface Pending {
  key: string
  name: string
  preview?: string
  photo?: ProcessedPhoto
  error?: string
  alt: string
}

const REASONS: Record<string, string> = {
  heic: ea.properties.photos.heic,
  not_image: ea.properties.photos.notImage,
  decode_failed: ea.properties.photos.decodeFailed,
}

export function PhotosSection({ property }: { property: PropertyRow }) {
  const id = useId()
  const [photos, setPhotos] = useState<PhotoRow[] | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('property_photos').select('*').eq('property_id', property.id).order('sort_order')
    setPhotos((data as PhotoRow[]) ?? [])
  }, [property.id])

  useEffect(() => {
    let cancelled = false
    supabase.from('property_photos').select('*').eq('property_id', property.id).order('sort_order')
      .then(({ data }) => !cancelled && setPhotos((data as PhotoRow[]) ?? []))
    return () => {
      cancelled = true
    }
  }, [property.id])

  async function pick(files: FileList | null) {
    if (!files) return
    const list = [...files]
    const items: Pending[] = list.map((f) => ({ key: crypto.randomUUID(), name: f.name, alt: '' }))
    setPending((p) => [...p, ...items])
    for (const [i, file] of list.entries()) {
      const result = await processPhoto(file)
      setPending((p) => p.map((x) => (x.key !== items[i].key ? x
        : result.ok ? { ...x, photo: result.photo, preview: URL.createObjectURL(result.photo.blob) }
          : { ...x, error: REASONS[result.reason] })))
    }
  }

  async function upload() {
    const ready = pending.filter((p) => p.photo && !p.error)
    if (ready.some((p) => p.alt.trim().length < 3)) return setMessage({ ok: false, text: ea.properties.photos.altLabel + ': ' + ea.common.required })
    setProgress({ done: 0, total: ready.length })
    let order = photos?.length ?? 0
    let hasCover = photos?.some((p) => p.is_cover) ?? false
    for (const [i, item] of ready.entries()) {
      const path = `${property.id}/${crypto.randomUUID()}.${item.photo!.extension}`
      const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, item.photo!.blob, { contentType: item.photo!.type, upsert: false })
      if (up.error) {
        setMessage({ ok: false, text: ea.common.genericError })
        break
      }
      const { error } = await supabase.from('property_photos')
        .insert({ property_id: property.id, storage_path: path, alt_text: item.alt.trim(), sort_order: order++, is_cover: !hasCover })
      if (error) {
        await supabase.storage.from(PHOTO_BUCKET).remove([path])
        setMessage({ ok: false, text: errorMessage(error) })
        break
      }
      hasCover = true
      if (item.preview) URL.revokeObjectURL(item.preview)
      setPending((p) => p.filter((x) => x.key !== item.key))
      setProgress({ done: i + 1, total: ready.length })
    }
    setProgress(null)
    await load()
  }

  async function reorder(ids: string[]) {
    const { error } = await supabase.rpc('admin_reorder_photos', { p_property_id: property.id, p_ids: ids })
    if (error) setMessage({ ok: false, text: errorMessage(error) })
    await load()
  }

  function move(index: number, delta: number) {
    if (!photos) return
    const ids = photos.map((p) => p.id)
    const [item] = ids.splice(index, 1)
    ids.splice(index + delta, 0, item)
    void reorder(ids)
  }

  function drop(targetId: string) {
    if (!photos || !dragId || dragId === targetId) return
    const ids = photos.map((p) => p.id).filter((x) => x !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    setDragId(null)
    void reorder(ids)
  }

  async function setCover(photoId: string) {
    const { error } = await supabase.rpc('admin_set_cover', { p_photo_id: photoId })
    if (error) setMessage({ ok: false, text: errorMessage(error) })
    await load()
  }

  async function remove(photo: PhotoRow) {
    if (!window.confirm(ea.properties.photos.deleteConfirm)) return
    const { data, error } = await supabase.rpc('admin_delete_photo', { p_photo_id: photo.id })
    const result = data as { ok: boolean; storage_path?: string; message?: string } | null
    if (error || !result?.ok) return setMessage({ ok: false, text: result?.message ?? errorMessage(error) })
    if (result.storage_path) await supabase.storage.from(PHOTO_BUCKET).remove([result.storage_path])
    await load()
  }

  async function saveAlt(photo: PhotoRow, alt: string) {
    if (alt.trim() === (photo.alt_text ?? '') || alt.trim().length < 3) return
    const { error } = await supabase.from('property_photos').update({ alt_text: alt.trim() }).eq('id', photo.id)
    setMessage(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: ea.common.saved })
  }

  const ph = ea.properties.photos
  const readyCount = pending.filter((p) => p.photo && !p.error).length
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-s text-ink-muted">{photos ? ph.count(photos.length) : ea.common.loading} · {ph.dragHint}</p>
      <ol className="grid gap-4 sm:grid-cols-2">
        {photos?.map((photo, index) => (
          <li key={photo.id} draggable onDragStart={() => setDragId(photo.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(photo.id)}
            className={`flex flex-col gap-3 rounded-l border p-3 ${photo.is_cover ? 'border-pacific' : 'border-line'} bg-surface`}>
            <img src={photoUrl(photo.storage_path)} alt="" className="aspect-[4/3] w-full rounded-m object-cover" loading="lazy" />
            {photo.is_cover && <p className="text-label uppercase tracking-widest text-pacific">{ph.cover}</p>}
            <Field id={`${id}-alt-${photo.id}`} label={ph.altLabel} defaultValue={photo.alt_text ?? ''} maxLength={200}
              onBlur={(e) => saveAlt(photo, e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${buttonSecondary} px-4`} disabled={index === 0} onClick={() => move(index, -1)}
                aria-label={ph.moveUpLabel(index + 1)}>{ph.moveUp}</button>
              <button type="button" className={`${buttonSecondary} px-4`} disabled={index === photos.length - 1} onClick={() => move(index, 1)}
                aria-label={ph.moveDownLabel(index + 1)}>{ph.moveDown}</button>
              {!photo.is_cover && <button type="button" className={`${buttonSecondary} px-4`} onClick={() => setCover(photo.id)}>{ph.makeCover}</button>}
              <button type="button" className={`${buttonSecondary} px-4`} onClick={() => remove(photo)}>{ea.common.delete}</button>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 rounded-l border border-border-control bg-sand-50 p-4">
        <label htmlFor={`${id}-files`} className="text-title text-ink">{ph.add}</label>
        <p className="text-body-s text-ink-muted">{ph.addHint}</p>
        <input id={`${id}-files`} type="file" accept="image/*" multiple onChange={(e) => { void pick(e.target.files); e.target.value = '' }}
          className="text-body-s text-ink file:mr-3 file:min-h-10 file:rounded-pill file:border file:border-border-control file:bg-surface file:px-5 file:text-button file:text-ink" />
        {pending.map((item) => (
          <div key={item.key} className="flex flex-col gap-2 border-t border-line pt-3">
            {item.preview && <img src={item.preview} alt="" className="aspect-[4/3] w-full max-w-[50%] rounded-m object-cover" />}
            <p className="text-body-s text-ink-muted">{item.name}</p>
            {item.error ? (
              <p className="flex items-start gap-2 text-body-s text-danger"><AlertIcon size={20} className="shrink-0" />{item.error}</p>
            ) : item.photo ? (
              <Field id={`${id}-pending-${item.key}`} label={ph.altLabel} hint={ph.altHint} required maxLength={200} value={item.alt}
                onChange={(e) => setPending((p) => p.map((x) => (x.key === item.key ? { ...x, alt: e.target.value } : x)))} />
            ) : (
              <p className="text-body-s text-ink-muted">{ea.common.loading}</p>
            )}
            <button type="button" className={`${buttonSecondary} self-start px-4`} onClick={() => setPending((p) => p.filter((x) => x.key !== item.key))}>
              {ph.removePending}
            </button>
          </div>
        ))}
        {readyCount > 0 && (
          <button type="button" className={`${buttonPrimary} self-start`} onClick={upload} disabled={progress !== null} aria-busy={progress !== null}>
            {progress ? ph.uploading(progress.done, progress.total) : ph.upload(readyCount)}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={`text-body-s ${message && !message.ok ? 'text-danger' : 'text-ink'}`}>{message?.text}</p>
    </div>
  )
}

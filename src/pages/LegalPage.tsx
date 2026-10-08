import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { container, textLink } from '../components/ui'
import { fetchLegalDocument } from '../lib/api/public'
import { useDocumentMeta } from '../lib/document-meta'
import { inlineSegments, parseLegalContent } from '../lib/legal-content'
import type { LegalKind, PublicLegalDocument } from '../types/public'
import { t } from '../lib/i18n'

// Documento legal vigente (public_legal_documents: la versión publicada más
// reciente). La reserva guarda qué versión aceptó el huésped.

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; doc: PublicLegalDocument }

export function LegalPage({ kind, title }: { kind: LegalKind; title: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useDocumentMeta(`${title} · ${t.meta.legalTitle}`)

  useEffect(() => {
    let cancelled = false
    fetchLegalDocument(kind)
      .then((doc) => !cancelled && setState(doc ? { status: 'ok', doc } : { status: 'missing' }))
      .catch(() => !cancelled && setState({ status: 'missing' }))
    return () => {
      cancelled = true
    }
  }, [kind])

  return (
    <article className={`${container} py-10`}>
      <h1 className="font-display text-heading text-ink">{state.status === 'ok' ? state.doc.title : title}</h1>

      {state.status === 'loading' && (
        <p role="status" className="mt-3 min-h-screen text-body text-ink-muted">
          {t.legal.loading}
        </p>
      )}
      {state.status === 'missing' && <p className="mt-3 max-w-prose text-body text-ink-muted">{t.legal.pending}</p>}
      {state.status === 'ok' && (
        <div className="mt-3 flex max-w-prose flex-col gap-4">
          <p className="text-body-s text-ink-muted">
            {t.legal.version(state.doc.version, new Date(state.doc.published_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }))}
          </p>
          {parseLegalContent(state.doc.content).map((block, i) =>
            block.type === 'heading' ? (
              <h2 key={i} className="mt-4 text-title text-ink">
                {block.text}
              </h2>
            ) : block.type === 'list' ? (
              <ul key={i} className="flex list-disc flex-col gap-2 pl-5 text-body text-ink">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i} className="text-body text-ink">
                <Inline text={block.text} />
              </p>
            ),
          )}
        </div>
      )}

      <Link to="/" className={`${textLink} mt-5 inline-flex min-h-10 items-center`}>
        {t.legal.backHome}
      </Link>
    </article>
  )
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineSegments(text).map((segment, i) => (segment.bold ? <strong key={i}>{segment.text}</strong> : <span key={i}>{segment.text}</span>))}
    </>
  )
}

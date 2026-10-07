import { useId, useState } from 'react'
import { CheckIcon } from '../icons'
import { textLink } from '../ui'
import { t } from '../../lib/i18n'

const VISIBLE = 6

// "Lo que incluye": las primeras 6 y "Ver todo" (desplegable accesible).
export function Amenities({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (items.length === 0) return null

  const shown = expanded ? items : items.slice(0, VISIBLE)

  return (
    <section aria-labelledby={`${listId}-title`}>
      <h2 id={`${listId}-title`} className="font-display text-heading-s text-ink">
        {t.property.amenitiesHeading}
      </h2>
      <ul id={listId} className="mt-4 grid gap-3 sm:grid-cols-2">
        {shown.map((item) => (
          <li key={item} className="flex items-center gap-3 text-body text-ink">
            <CheckIcon size={20} className="shrink-0 text-pacific" />
            {item}
          </li>
        ))}
      </ul>
      {items.length > VISIBLE && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className={`${textLink} mt-3 inline-flex min-h-10 items-center text-body`}
        >
          {expanded ? t.property.amenitiesShowLess : t.property.amenitiesShowAll(items.length)}
        </button>
      )}
    </section>
  )
}

import type { ReactNode } from 'react'
import { BathIcon, BedIcon, DoorIcon, UsersIcon } from '../icons'
import type { PublicProperty } from '../../types/public'
import { t } from '../../lib/i18n'

// Huéspedes, dormitorios, camas y baños. Un dato null o 0 se omite: nunca
// se muestra "null" ni "0".
export function PropertyFacts({ property }: { property: PublicProperty }) {
  const facts: { icon: ReactNode; text: string }[] = []
  const add = (value: number | null, icon: ReactNode, text: (n: number) => string) => {
    if (value) facts.push({ icon, text: text(value) })
  }
  add(property.max_guests, <UsersIcon size={20} />, t.property.guests)
  add(property.bedrooms, <DoorIcon size={20} />, t.property.bedrooms)
  add(property.beds, <BedIcon size={20} />, t.property.beds)
  add(property.bathrooms, <BathIcon size={20} />, t.property.bathrooms)

  if (facts.length === 0) return null

  return (
    <ul aria-label={t.property.factsLabel} className="flex flex-wrap gap-x-5 gap-y-2">
      {facts.map((fact) => (
        <li key={fact.text} className="inline-flex items-center gap-2 text-body-s text-ink-muted">
          <span className="text-earth">{fact.icon}</span>
          {fact.text}
        </li>
      ))}
    </ul>
  )
}

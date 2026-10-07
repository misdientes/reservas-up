import { ChatIcon, ReceiptIcon, TagOffIcon } from '../icons'
import { container } from '../ui'
import { t } from '../../lib/i18n'

const ICONS = [TagOffIcon, ReceiptIcon, ChatIcon]

// Bloque de marca: Pacífico con texto arena e íconos dawn. Solo beneficios
// verdaderos (guía: nunca cifras ni testimonios inventados).
export function DirectBlock() {
  return (
    <section id="reserva-directo" aria-labelledby="direct-title" className={`${container} scroll-mt-5`}>
      <div className="rounded-xl bg-pacific p-7 text-sand-100 md:p-10">
        <h2 id="direct-title" className="font-display text-heading-s md:text-heading">
          {t.direct.heading}
        </h2>
        <p className="mt-3 max-w-prose text-body">{t.direct.lead}</p>
        <ul className="mt-7 grid gap-7 md:grid-cols-3">
          {t.direct.benefits.map((benefit, index) => {
            const Icon = ICONS[index]
            return (
              <li key={benefit.title} className="flex gap-3 border-t border-sand-100/30 pt-4">
                <Icon size={26} className="shrink-0 text-dawn" />
                <div>
                  <p className="text-title">{benefit.title}</p>
                  <p className="mt-2 text-body-s">{benefit.text}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

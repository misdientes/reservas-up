import { HorizonArt } from '../icons'
import { container } from '../ui'
import { t } from '../../lib/i18n'

// La pieza memorable de la página: el título en Instrument Serif a gran
// tamaño, con "frente al Pacífico." en itálica terracota (guía Costa y
// Pampa), sobre un horizonte de mar y pampa trazado en línea.
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className={`${container} pt-10`}>
      <div className="grid items-end gap-7 md:grid-cols-12">
        <div className="md:col-span-8">
          <h1 id="hero-title" className="font-display text-display-l text-ink md:text-display-xl">
            {t.hero.titleStart} <em className="text-terracotta italic">{t.hero.titleAccent}</em>
          </h1>
          <p className="mt-5 max-w-prose text-body text-ink-muted md:mt-7">{t.hero.lead}</p>
        </div>
        <HorizonArt className="hidden w-full text-pacific md:col-span-4 md:block" />
      </div>
    </section>
  )
}

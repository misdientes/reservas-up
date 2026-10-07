import { HorizonArt } from './icons'

// Respaldo cuando no hay foto: bloque Pacífico con el horizonte en dawn.
// Decorativo (aria-hidden): el nombre de la propiedad ya está en el texto.
export function PhotoFallback({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-l bg-pacific p-7 ${className}`} aria-hidden="true">
      <HorizonArt className="w-full text-dawn" />
    </div>
  )
}

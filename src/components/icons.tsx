import type { SVGProps } from 'react'

// Íconos de trazo (guía Costa y Pampa: trazo 1.8, puntas redondeadas,
// 20–26 px, nunca emojis). Heredan el color del texto (currentColor) y son
// decorativos por defecto: el texto o el aria-label del control los nombra.

type IconProps = SVGProps<SVGSVGElement> & { size?: 20 | 22 | 24 | 26 }

function Icon({ size = 22, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

// Globo de conversación (WhatsApp sin usar su logo).
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" />
      <path d="M9 11h6M9 14h4" />
    </Icon>
  )
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.7-3 2.9-4.6 5.5-4.6s4.8 1.6 5.5 4.6" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.6 2 3 4.4" />
    </Icon>
  )
}

export function ReceiptIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </Icon>
  )
}

export function TagOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12V4h8l9 9-7 7-9-8Z" />
      <circle cx="7.5" cy="8" r="1.2" />
      <path d="M4 20 20 4" />
    </Icon>
  )
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5h6v2M3 13h18" />
    </Icon>
  )
}

// Horizonte: el mar (línea recta) y la pampa (lomas). Firma visual del sitio.
export function HorizonArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="292" cy="58" r="18" />
      <path d="M8 76h384" />
      <path d="M8 96c40-14 76-30 122-30 50 0 70 22 118 22 46 0 86-20 144-8" />
      <path d="M40 108h60M160 108h90M290 108h70" />
    </svg>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  )
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </Icon>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5l7 7-7 7" />
    </Icon>
  )
}

export function KeyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
    </Icon>
  )
}

export function DoorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18" />
      <path d="M14 12h.01" />
    </Icon>
  )
}

export function BedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="1.6" />
    </Icon>
  )
}

export function BathIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-3Z" />
      <path d="M6 12V6a2 2 0 0 1 3.6-1.2M7 20l-1 2M17 20l1 2" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  )
}

export function ImagesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="15" height="13" rx="2" />
      <path d="M21 8v11a2 2 0 0 1-2 2H7M3 15l4-4 4 4 3-3 4 4" />
    </Icon>
  )
}

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Icon>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </Icon>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>
  )
}

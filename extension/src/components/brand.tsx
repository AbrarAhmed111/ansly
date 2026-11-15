import type { ReactNode } from 'react'
// Inlined as a data URL: the in-page UI lives in a shadow root on other sites, where extension URLs
// would need web_accessible_resources. Same mark as the web app (web/src/components/logo.tsx).
import logoMark from '@/assets/logo-mark.png?inline'

/** The Ansly mark (the purple cursor), sized in px. Decorative: the name is always next to it or in a label. */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <img
      src={logoMark}
      alt=""
      aria-hidden="true"
      width={Math.round(size * 0.73)}
      height={size}
      className={className ? `logo-mark ${className}` : 'logo-mark'}
      draggable={false}
    />
  )
}

/** Mark + wordmark, for headers. */
export function Brand({ size = 18 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <span className="brand-name">Ansly</span>
    </span>
  )
}

/* Line icons in the web app's style (lucide geometry, 24px grid, 2px stroke). */
const ICONS = {
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  minus: <path d="M5 12h14" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  arrowUpRight: <path d="M7 17 17 7M7 7h10v10" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  plug: <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M10 13H8M16 17H8M16 13h-2" />
    </>
  ),
  sparkles: (
    <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/** Small tinted square holding an icon, like the web app's IconTile. */
export function IconTile({ icon, tone = 'neutral', size = 'md' }: { icon: IconName; tone?: Tone; size?: 'sm' | 'md' }) {
  return (
    <span className={`icon-tile t-${tone} ${size}`}>
      <Icon name={icon} size={size === 'sm' ? 14 : 18} />
    </span>
  )
}

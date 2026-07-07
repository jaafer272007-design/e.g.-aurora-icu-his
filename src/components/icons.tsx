/* Shared inline SVG icons, stroke markup identical to the /reference prototypes. */

interface IconProps {
  size?: number
  stroke?: string
  strokeWidth?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  strokeLinecap: 'round' as const,
})

export function IconPulse({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M2 12h4l2-6 4 12 2-6h8" />
    </svg>
  )
}

export function IconGrid({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </svg>
  )
}

export function IconBed({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth}>
      <path d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M6 10V7a2 2 0 012-2h3v5" />
    </svg>
  )
}

export function IconAdmit({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H3" />
    </svg>
  )
}

export function IconDischarge({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3M14 17l5-5-5-5M19 12H7" />
    </svg>
  )
}

export function IconAlertTriangle({ size = 16, stroke = 'currentColor', strokeWidth = 2, plain = false }: IconProps & { plain?: boolean }) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M12 3l10 18H2L12 3z" />
      {!plain && <path d="M12 10v4m0 3v.01" />}
    </svg>
  )
}

export function IconStats({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth}>
      <path d="M4 20V10m6 10V4m6 16v-7" />
    </svg>
  )
}

export function IconSettings({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.2a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.2a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.2a1.7 1.7 0 001 1.5h.1a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1h.2a2 2 0 110 4h-.2a1.7 1.7 0 00-1.5 1z" />
    </svg>
  )
}

export function IconBell({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 01-3.4 0" />
    </svg>
  )
}

export function IconSearch({ size = 14, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}

export function IconVent({ size = 16, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M12 3v8m0 0c-3 0-5 2-5 5s2 5 5 5 5-2 5-5-2-5-5-5z" />
    </svg>
  )
}

export function IconCheck({ size = 11, stroke = '#06121f', strokeWidth = 3.4 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

export function IconFlask({ size = 15, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round">
      <path d="M9 3h6M10 3v6l-5 9a3 3 0 003 5h8a3 3 0 003-5l-5-9V3" />
    </svg>
  )
}

export function IconPencil({ size = 15, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  )
}

export function IconNote({ size = 15, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth}>
      <path d="M4 19V6a2 2 0 012-2h8l6 6v9a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
      <path d="M14 4v6h6" />
    </svg>
  )
}

export function IconUsers({ size = 14, stroke = 'currentColor', strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={stroke} strokeWidth={strokeWidth}>
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}

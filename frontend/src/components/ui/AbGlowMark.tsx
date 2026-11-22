import { useId } from 'react'
import styles from './AbGlowMark.module.css'

const MONOGRAM =
  'M0 100 L16 100 L24 84 L50 84 L50 100 L80 100 A26 26 0 0 0 80 48 L64 48 L64 44 L78 44 A22 22 0 0 0 78 0 L50 0 Z M31 70 L50 70 L50 32 Z M64 14 L78 14 A8 8 0 0 1 78 30 L64 30 Z M64 62 L80 62 A12 12 0 0 1 80 86 L64 86 Z'
const CROSSBAR = 'M31 70 L50 70 L50 84 L24 84 Z'

/** The AB CREATIONS monogram for dark backgrounds: a near-black body with a
 * one-sided rim light, a soft halo, and the amber crossbar lit like an LED strip.
 * Decorative glow animates slowly and stops under prefers-reduced-motion. */
export function AbGlowMark({ label, className }: { label: string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const big = `${uid}big`
  const mid = `${uid}mid`
  const bar = `${uid}bar`
  const rim = `${uid}rim`
  const halo = `${uid}halo`

  return (
    <svg
      className={className}
      viewBox="-60 -40 226 180"
      role="img"
      aria-label={label}
    >
      <defs>
        <filter id={big} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="13" />
        </filter>
        <filter id={mid} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={bar} x="-80%" y="-200%" width="260%" height="500%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id={rim} gradientUnits="userSpaceOnUse" x1="-6" y1="104" x2="112" y2="-4">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="0.32" stopColor="#D5E2F4" stopOpacity="0.6" />
          <stop offset="0.68" stopColor="#C9D8EE" stopOpacity="0.08" />
          <stop offset="1" stopColor="#C9D8EE" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={halo} gradientUnits="userSpaceOnUse" x1="-6" y1="104" x2="112" y2="-4">
          <stop offset="0" stopColor="#DDE8F8" stopOpacity="1" />
          <stop offset="0.45" stopColor="#9FB6D8" stopOpacity="0.35" />
          <stop offset="0.8" stopColor="#9FB6D8" stopOpacity="0" />
          <stop offset="1" stopColor="#9FB6D8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className={styles.glow} aria-hidden="true">
        <path d={MONOGRAM} fill={`url(#${halo})`} fillRule="evenodd" filter={`url(#${big})`} transform="translate(-9 3)" />
        <path d={MONOGRAM} fill={`url(#${halo})`} fillRule="evenodd" filter={`url(#${mid})`} transform="translate(-2.5 1)" opacity="0.7" />
        <path d={MONOGRAM} fill={`url(#${halo})`} fillRule="evenodd" filter={`url(#${big})`} transform="translate(-12 5)" opacity="0.55" />
      </g>
      <path d={MONOGRAM} fill="#06080D" fillRule="evenodd" />
      <path d={MONOGRAM} fill="none" stroke={`url(#${rim})`} strokeWidth="1.3" strokeLinejoin="round" />
      <g className={styles.bar} aria-hidden="true">
        <path d={CROSSBAR} fill="#F59E0B" filter={`url(#${bar})`} opacity="0.75" />
        <path d={CROSSBAR} fill="#F59E0B" />
      </g>
    </svg>
  )
}

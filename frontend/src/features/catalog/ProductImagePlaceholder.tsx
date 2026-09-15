import styles from './ProductImagePlaceholder.module.css'

function getProductArtwork(label: string) {
  const l = label.toLowerCase()
  if (l.includes('mug') || l.includes('cup')) {
    return (
      <svg viewBox="0 0 160 160" className={styles.vectorArt} aria-hidden="true">
        <defs>
          <linearGradient id="mugGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
          <linearGradient id="printArea" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        {/* Steam */}
        <path d="M65 30 Q60 20 65 14" stroke="#94a3b8" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M78 28 Q83 18 78 12" stroke="#94a3b8" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
        {/* Handle */}
        <path d="M102 60 C125 60 125 105 102 105" stroke="#cbd5e1" strokeWidth="10" fill="none" strokeLinecap="round" />
        {/* Mug Body */}
        <rect x="42" y="44" width="62" height="74" rx="8" fill="url(#mugGrad)" stroke="#cbd5e1" strokeWidth="2.5" />
        {/* Print zone */}
        <rect x="50" y="58" width="46" height="46" rx="4" fill="url(#printArea)" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="3 3" />
        <text x="73" y="84" textAnchor="middle" fontSize="9" fontWeight="600" fill="#1e40af" fontFamily="system-ui">YOUR PRINT</text>
        {/* Rim top ellipse */}
        <ellipse cx="73" cy="44" rx="31" ry="6" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2" />
      </svg>
    )
  }

  if (l.includes('shirt') || l.includes('tee') || l.includes('hoodie') || l.includes('apparel')) {
    return (
      <svg viewBox="0 0 160 160" className={styles.vectorArt} aria-hidden="true">
        <defs>
          <linearGradient id="shirtGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
          <linearGradient id="teePrint" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        {/* Shirt body */}
        <path
          d="M50 38 L30 54 L42 74 L54 66 L54 126 L106 126 L106 66 L118 74 L130 54 L110 38 Q80 50 50 38 Z"
          fill="url(#shirtGrad)"
          stroke="#cbd5e1"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* Collar */}
        <path d="M64 38 Q80 54 96 38" stroke="#94a3b8" strokeWidth="2" fill="none" />
        {/* Print area */}
        <rect x="65" y="66" width="30" height="38" rx="3" fill="url(#teePrint)" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="3 3" />
        <text x="80" y="88" textAnchor="middle" fontSize="7" fontWeight="600" fill="#1e40af" fontFamily="system-ui">CUSTOM</text>
      </svg>
    )
  }

  if (l.includes('frame') || l.includes('poster') || l.includes('photo')) {
    return (
      <svg viewBox="0 0 160 160" className={styles.vectorArt} aria-hidden="true">
        <defs>
          <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#78350f" />
            <stop offset="100%" stopColor="#451a03" />
          </linearGradient>
          <linearGradient id="photoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#dbeafe" />
            <stop offset="100%" stopColor="#bfdbfe" />
          </linearGradient>
        </defs>
        {/* Outer wood frame */}
        <rect x="36" y="32" width="88" height="96" rx="4" fill="#854d0e" stroke="#713f12" strokeWidth="2" />
        <rect x="44" y="40" width="72" height="80" fill="#ffffff" />
        {/* Inner photo mat */}
        <rect x="52" y="48" width="56" height="64" rx="2" fill="url(#photoGrad)" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="3 3" />
        <circle cx="68" cy="66" r="6" fill="#60a5fa" opacity="0.6" />
        <path d="M54 98 L72 80 L88 94 L106 74" stroke="#3b82f6" strokeWidth="2" fill="none" strokeLinecap="round" />
        <text x="80" y="106" textAnchor="middle" fontSize="7" fontWeight="600" fill="#1e40af" fontFamily="system-ui">HIGH-RES PRINT</text>
      </svg>
    )
  }

  if (l.includes('card') || l.includes('business')) {
    return (
      <svg viewBox="0 0 160 160" className={styles.vectorArt} aria-hidden="true">
        <defs>
          <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        {/* Back card */}
        <rect x="42" y="58" width="80" height="52" rx="4" fill="#cbd5e1" transform="rotate(-6 82 84)" />
        {/* Front card */}
        <rect x="38" y="50" width="84" height="54" rx="4" fill="url(#cardGrad)" stroke="#334155" strokeWidth="1.5" />
        {/* Foil logo */}
        <circle cx="56" cy="74" r="8" fill="#f59e0b" opacity="0.8" />
        <line x1="70" y1="70" x2="108" y2="70" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
        <line x1="70" y1="76" x2="98" y2="76" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="70" y1="82" x2="90" y2="82" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />
      </svg>
    )
  }

  // Default: custom print studio template
  return (
    <svg viewBox="0 0 160 160" className={styles.vectorArt} aria-hidden="true">
      <defs>
        <linearGradient id="defaultGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#eff6ff" />
          <stop offset="100%" stopColor="#dbeafe" />
        </linearGradient>
      </defs>
      <rect x="36" y="36" width="88" height="88" rx="8" fill="url(#defaultGrad)" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4 4" />
      <circle cx="80" cy="74" r="16" fill="#3b82f6" opacity="0.2" />
      <path d="M74 74 L80 68 L86 74" stroke="#1d4ed8" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M80 68 L80 82" stroke="#1d4ed8" strokeWidth="2" fill="none" strokeLinecap="round" />
      <text x="80" y="104" textAnchor="middle" fontSize="8" fontWeight="600" fill="#1e40af" fontFamily="system-ui">CUSTOM PRINT</text>
    </svg>
  )
}

/**
 * Renders an artisan mockup for products whose images are missing or
 * pending customer artwork upload, while maintaining full accessibility
 * invariants (role="img", label fallback).
 */
export function ProductImagePlaceholder({ label }: { label: string }) {
  return (
    <div className={styles.placeholder} role="img" aria-label={`${label} — no image available`}>
      {getProductArtwork(label)}
      <div className={styles.overlayTag} aria-hidden="true">
        <span>Custom Printed</span>
      </div>
    </div>
  )
}

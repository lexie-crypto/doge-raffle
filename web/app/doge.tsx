"use client";

/** Golden Ð coin (inline SVG — no external assets). */
export function DogeCoin({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <radialGradient id="dcoin" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="45%" stopColor="#f2c744" />
          <stop offset="100%" stopColor="#d9960b" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#dcoin)" stroke="#b8860b" strokeWidth="3" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="#b8860b" strokeWidth="2" opacity="0.5" />
      <text
        x="50"
        y="68"
        textAnchor="middle"
        fontSize="52"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fill="#8a6508"
      >
        Ð
      </text>
    </svg>
  );
}

/** Original shiba-inu mascot face (inline SVG). */
export function ShibaFace({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden>
      {/* ears */}
      <path d="M38 78 L22 18 L78 44 Z" fill="#e8a33d" stroke="#b97c1e" strokeWidth="5" strokeLinejoin="round" />
      <path d="M162 78 L178 18 L122 44 Z" fill="#e8a33d" stroke="#b97c1e" strokeWidth="5" strokeLinejoin="round" />
      <path d="M40 66 L32 32 L64 48 Z" fill="#f7d9b8" />
      <path d="M160 66 L168 32 L136 48 Z" fill="#f7d9b8" />
      {/* head */}
      <ellipse cx="100" cy="112" rx="78" ry="72" fill="#e8a33d" stroke="#b97c1e" strokeWidth="5" />
      {/* cheeks + muzzle (cream) */}
      <ellipse cx="100" cy="138" rx="56" ry="42" fill="#fdf3e3" />
      <ellipse cx="42" cy="118" rx="18" ry="24" fill="#fdf3e3" />
      <ellipse cx="158" cy="118" rx="18" ry="24" fill="#fdf3e3" />
      {/* eyebrows */}
      <ellipse cx="68" cy="84" rx="9" ry="6" fill="#fdf3e3" />
      <ellipse cx="132" cy="84" rx="9" ry="6" fill="#fdf3e3" />
      {/* eyes */}
      <circle cx="68" cy="102" r="7.5" fill="#3b2a12" />
      <circle cx="132" cy="102" r="7.5" fill="#3b2a12" />
      <circle cx="70.5" cy="99.5" r="2.5" fill="#fff" />
      <circle cx="134.5" cy="99.5" r="2.5" fill="#fff" />
      {/* blush */}
      <ellipse cx="52" cy="128" rx="11" ry="6" fill="#f6b8a0" opacity="0.8" />
      <ellipse cx="148" cy="128" rx="11" ry="6" fill="#f6b8a0" opacity="0.8" />
      {/* nose + mouth */}
      <ellipse cx="100" cy="126" rx="9" ry="7" fill="#3b2a12" />
      <path
        d="M100 133 Q100 144 88 146 M100 133 Q100 144 112 146"
        fill="none"
        stroke="#3b2a12"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {/* tongue */}
      <path d="M92 150 Q100 160 108 150 Q104 158 100 158 Q96 158 92 150 Z" fill="#ef8f8f" />
    </svg>
  );
}

/** "Built on DogeOS" badge — the thing we're promoting. */
export function DogeOSBadge() {
  return (
    <a
      href="https://dogeos.com"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-full border-2 border-amber-400 bg-amber-50 px-4 py-1.5 text-sm font-bold text-amber-700 shadow-sm transition hover:bg-amber-100"
    >
      <DogeCoin size={18} />
      <span>
        Built on <span className="text-amber-900">DogeOS</span>
      </span>
    </a>
  );
}

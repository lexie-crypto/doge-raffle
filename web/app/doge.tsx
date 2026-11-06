"use client";

/* ===== such components. very doge. ===== */

/** Golden Ð coin (inline SVG — no external assets). */
export function DogeCoin({ size = 48, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={spin ? "coin-spin" : undefined}
      aria-hidden
    >
      <defs>
        <radialGradient id="dcoin" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="45%" stopColor="#f2c744" />
          <stop offset="100%" stopColor="#b8860b" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#dcoin)" stroke="#8a6508" strokeWidth="3" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="#8a6508" strokeWidth="2" opacity="0.6" />
      <text
        x="50"
        y="68"
        textAnchor="middle"
        fontSize="52"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fill="#6b4e03"
      >
        Ð
      </text>
    </svg>
  );
}

const WOW_WORDS = [
  { text: "wow", color: "#f2c744", top: "12%", left: "4%", delay: "0s", tilt: "-8deg" },
  { text: "such jackpot", color: "#7dd3fc", top: "28%", left: "88%", delay: "1.2s", tilt: "6deg" },
  { text: "very random", color: "#86efac", top: "55%", left: "2%", delay: "2.4s", tilt: "-5deg" },
  { text: "much DOGE", color: "#fda4af", top: "70%", left: "90%", delay: "0.7s", tilt: "7deg" },
  { text: "so verifiable", color: "#c4b5fd", top: "42%", left: "93%", delay: "3.1s", tilt: "-6deg" },
  { text: "to the moon", color: "#fdba74", top: "85%", left: "6%", delay: "1.9s", tilt: "4deg" },
  { text: "very win", color: "#f9a8d4", top: "8%", left: "72%", delay: "2.8s", tilt: "-3deg" },
];

/** Floating comic-sans doge-speak around the page. */
export function WowWords() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 hidden sm:block" aria-hidden>
      {WOW_WORDS.map((w) => (
        <span
          key={w.text}
          className="doge-speak float-word absolute text-xl font-bold"
          style={{
            color: w.color,
            top: w.top,
            left: w.left,
            animationDelay: w.delay,
            ["--tilt" as string]: w.tilt,
            opacity: 0,
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}

/** Slow golden coin rain. */
export function CoinRain() {
  const coins = [
    { left: "8%", duration: "11s", delay: "0s", size: 22 },
    { left: "22%", duration: "14s", delay: "3s", size: 16 },
    { left: "38%", duration: "12s", delay: "6s", size: 20 },
    { left: "57%", duration: "15s", delay: "1.5s", size: 14 },
    { left: "71%", duration: "13s", delay: "4.5s", size: 24 },
    { left: "86%", duration: "16s", delay: "7.5s", size: 18 },
  ];
  return (
    <div aria-hidden>
      {coins.map((c, i) => (
        <div
          key={i}
          className="coin-fall"
          style={{ left: c.left, animationDuration: c.duration, animationDelay: c.delay }}
        >
          <DogeCoin size={c.size} />
        </div>
      ))}
    </div>
  );
}

/** Scrolling moon-ticker. */
export function DogeTicker() {
  const items =
    "🚀 WOW · SUCH JACKPOT · 🐕 VERY RANDOM · MUCH WIN · Ð TO THE MOON · SO VERIFIABLE · 1 DOGE = 1 DOGE · ";
  return (
    <div className="relative z-10 mb-8 overflow-hidden rounded-full border-2 border-amber-500/60 bg-amber-950/60">
      <div className="ticker-track doge-speak py-1.5 text-sm font-bold tracking-wider text-amber-300">
        <span>{items}</span>
        <span>{items}</span>
      </div>
    </div>
  );
}

/** "Built on DogeOS" badge — the thing we're promoting. */
export function DogeOSBadge() {
  return (
    <a
      href="https://dogeos.com"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-full border-2 border-amber-400 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 px-4 py-1.5 font-bold text-amber-300 transition hover:scale-105 hover:bg-amber-500/30"
    >
      <DogeCoin size={20} />
      <span>
        Built on <span className="text-amber-200">DogeOS</span>
      </span>
      <span className="wiggle">🐕</span>
    </a>
  );
}

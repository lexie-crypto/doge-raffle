"use client";

/*
 * Doge artwork. Both images come from the Dogecoin Core repository
 * (github.com/dogecoin/dogecoin, MIT license):
 *  - /dogecoin-coin.svg  share/pixmaps/dogecoin256.svg (official coin logo) with
 *                        its white "D" overlay removed — Doge face only
 *  - /doge-wow-seal.png  medallion cropped from src/qt/res/icons/paper_wallet.png
 */

/* eslint-disable @next/next/no-img-element */

export function DogeCoin({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/dogecoin-coin.svg"
      width={size}
      height={size}
      alt="Dogecoin"
      className={className}
      draggable={false}
    />
  );
}

export function WowSeal({ size = 110, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/doge-wow-seal.png"
      width={size}
      height={size}
      alt="Doge — wow"
      className={className}
      draggable={false}
    />
  );
}

/** "Built on DogeOS" badge — the thing we're promoting. */
export function DogeOSBadge({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://dogeos.com"
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-2 rounded-full border-2 border-[#c2a633] bg-white/80 px-4 py-1.5 text-sm font-bold text-amber-800 shadow-sm backdrop-blur transition hover:bg-amber-50 ${className}`}
    >
      <DogeCoin size={20} />
      <span>
        Built on <span className="text-amber-950">DogeOS</span>
      </span>
    </a>
  );
}

/** Rotating sunburst behind the hero coin. */
export function Rays({ size = 560 }: { size?: number }) {
  const n = 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-100 -100 200 200"
      className="rays pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      aria-hidden
    >
      <defs>
        <radialGradient id="rayfade">
          <stop offset="0%" stopColor="#f7d660" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#f7d660" stopOpacity="0" />
        </radialGradient>
      </defs>
      {Array.from({ length: n }, (_, i) => (
        <path
          key={i}
          d="M0 0 L-6 -100 L6 -100 Z"
          fill="url(#rayfade)"
          transform={`rotate(${(360 / n) * i})`}
        />
      ))}
    </svg>
  );
}

/** Real-logo coins raining down inside a relatively positioned parent. */
export function CoinRain({ count = 10 }: { count?: number }) {
  const coins = Array.from({ length: count }, (_, i) => ({
    left: `${(i * 97) % 100}%`,
    size: 18 + ((i * 13) % 26),
    duration: `${9 + ((i * 7) % 9)}s`,
    delay: `${(i * 1.7) % 9}s`,
  }));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
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

/** A little stack of coins, used on the bundle cards. */
export function CoinStack({ coins }: { coins: number }) {
  const shown = Math.min(coins, 5);
  return (
    <div className="relative h-14" style={{ width: 44 + (shown - 1) * 24 }} aria-hidden>
      {Array.from({ length: shown }, (_, i) => (
        <div key={i} className="absolute" style={{ left: i * 24, top: i % 2 ? 4 : 0, zIndex: i }}>
          <DogeCoin size={44} className="drop-shadow" />
        </div>
      ))}
    </div>
  );
}

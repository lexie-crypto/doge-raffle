"use client";

import Image from "next/image";

/**
 * Official Dogecoin logo. Source: dogecoin/dogecoin (Dogecoin Core),
 * src/qt/res/icons/dogecoin.png, MIT license. Pre-resized copies live in
 * /public, so Next's image optimizer isn't needed.
 */
export function DogeCoin({
  size = 48,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const src = size > 64 ? "/dogecoin-logo.png" : "/dogecoin-logo-128.png";
  return (
    <Image
      src={src}
      width={size}
      height={size}
      alt="Dogecoin"
      className={className}
      priority={size > 64}
      unoptimized
    />
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
      <DogeCoin size={20} />
      <span>
        Built on <span className="text-amber-900">DogeOS</span>
      </span>
    </a>
  );
}

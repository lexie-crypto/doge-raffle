"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { CoinStack, DogeCoin } from "./doge";

export type Bundle = { tickets: number; price: bigint };

const fmt = (wei: bigint, digits = 2) =>
  Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: digits });

export function tierLabel(tickets: number): string {
  if (tickets >= 1000) return "Whale";
  if (tickets >= 100) return "High roller";
  if (tickets >= 10) return "Value pack";
  if (tickets >= 5) return "Most popular";
  return "Starter";
}

/** % saved per ticket versus buying singles. */
export function savePct(b: Bundle, single?: Bundle): number {
  if (!single || b.tickets <= 1) return 0;
  return Math.round((1 - Number(b.price) / (Number(single.price) * b.tickets)) * 100);
}

/* ------------------------------------------------------------ ticket card */

function BundleCard({
  b,
  single,
  featured,
  cta,
  disabled,
  onBuy,
}: {
  b: Bundle;
  single?: Bundle;
  featured: boolean;
  cta: string;
  disabled: boolean;
  onBuy: () => void;
}) {
  const save = savePct(b, single);
  const surface = featured ? "gold-card" : "bg-white";
  return (
    <div className="ticket w-full">
      <div className={`p-6 pb-5 ${surface}`}>
        <div className="flex items-start justify-between gap-2">
          <span
            className={`display rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              featured ? "bg-amber-950 text-amber-300" : "bg-amber-100 text-amber-700"
            }`}
          >
            {tierLabel(b.tickets)}
          </span>
          {save > 0 && <span className="display text-sm font-bold text-emerald-600">save {save}%</span>}
        </div>
        <div className="mt-4 h-14">
          <CoinStack coins={b.tickets} size={40} />
        </div>
        <div className="display mt-3 text-4xl font-bold text-amber-950">
          {b.tickets.toLocaleString()} ticket{b.tickets > 1 ? "s" : ""}
        </div>
      </div>
      <div className={`ticket-perf flex items-center justify-between gap-3 px-6 py-4 ${surface}`}>
        <div className="min-w-0">
          <div className="display text-2xl font-bold text-amber-700">{fmt(b.price, 0)} DOGE</div>
          <div className="text-xs text-amber-900/60">{fmt(b.price / BigInt(b.tickets), 1)} DOGE per ticket</div>
        </div>
        <button
          onClick={onBuy}
          disabled={disabled}
          className="doge-btn display shrink-0 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cta}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ carousel */

const mod = (i: number, n: number) => ((i % n) + n) % n;

/**
 * Looping carousel of bundles: arrows and dots wrap around in both
 * directions. Desktop shows the selected card in the middle with its
 * neighbours either side (click a neighbour to bring it to the centre);
 * mobile shows one card at a time.
 */
export function BundleCarousel({
  bundles,
  isConnected,
  disabled,
  onBuy,
}: {
  bundles: readonly Bundle[];
  isConnected: boolean;
  disabled: boolean;
  onBuy: (index: number, price: bigint) => void;
}) {
  const n = bundles.length;
  const [i, setI] = useState(1);
  useEffect(() => {
    if (n && i >= n) setI(0);
  }, [n, i]);
  if (n === 0) return null;
  const at = (k: number) => mod(k, n);
  const cta = isConnected ? "Buy" : "Connect & buy";
  const single = bundles.find((b) => b.tickets === 1);

  const Arrow = ({ dir }: { dir: -1 | 1 }) => (
    <button
      onClick={() => setI((x) => at(x + dir))}
      aria-label={dir < 0 ? "Previous bundle" : "Next bundle"}
      className="doge-btn display z-20 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-white text-2xl font-bold text-amber-900 shadow-md hover:border-amber-500"
    >
      {dir < 0 ? "‹" : "›"}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-center gap-3 sm:gap-5">
        <Arrow dir={-1} />
        {/* mobile: one card */}
        <div className="w-full max-w-sm md:hidden">
          <BundleCard b={bundles[at(i)]} single={single} featured cta={cta} disabled={disabled} onBuy={() => onBuy(at(i), bundles[at(i)].price)} />
        </div>
        {/* desktop: neighbours + centre */}
        <div className="hidden w-full max-w-5xl grid-cols-[1fr_1.15fr_1fr] items-center gap-5 md:grid">
          {n > 1 && (
            <button
              onClick={() => setI((x) => at(x - 1))}
              className="origin-right scale-90 cursor-pointer text-left opacity-60 transition hover:opacity-90"
              aria-label="Show previous bundle"
            >
              <div className="pointer-events-none">
                <BundleCard b={bundles[at(i - 1)]} single={single} featured={false} cta={cta} disabled onBuy={() => undefined} />
              </div>
            </button>
          )}
          <div className="relative z-10 drop-shadow-2xl">
            <BundleCard b={bundles[at(i)]} single={single} featured cta={cta} disabled={disabled} onBuy={() => onBuy(at(i), bundles[at(i)].price)} />
          </div>
          {n > 1 && (
            <button
              onClick={() => setI((x) => at(x + 1))}
              className="origin-left scale-90 cursor-pointer text-left opacity-60 transition hover:opacity-90"
              aria-label="Show next bundle"
            >
              <div className="pointer-events-none">
                <BundleCard b={bundles[at(i + 1)]} single={single} featured={false} cta={cta} disabled onBuy={() => undefined} />
              </div>
            </button>
          )}
        </div>
        <Arrow dir={1} />
      </div>
      <div className="mt-6 flex justify-center gap-2">
        {bundles.map((b, k) => (
          <button
            key={k}
            onClick={() => setI(k)}
            aria-label={`${b.tickets} tickets`}
            className={`h-3 rounded-full transition-all ${k === at(i) ? "w-8 bg-amber-500" : "w-3 bg-amber-200 hover:bg-amber-300"}`}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ buy popup */

export function BuyModal({
  open,
  onClose,
  bundles,
  myTickets,
  totalTickets,
  isConnected,
  disabled,
  status,
  onBuy,
}: {
  open: boolean;
  onClose: () => void;
  bundles: readonly Bundle[];
  myTickets: bigint;
  totalTickets: bigint;
  isConnected: boolean;
  disabled: boolean;
  status?: React.ReactNode;
  onBuy: (index: number, price: bigint) => void;
}) {
  const [sel, setSel] = useState(1);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || bundles.length === 0) return null;
  const k = Math.min(sel, bundles.length - 1);
  const chosen = bundles[k];
  const single = bundles.find((b) => b.tickets === 1);
  const mine = Number(myTickets) + chosen.tickets;
  const total = Number(totalTickets) + chosen.tickets;
  const odds = ((mine / total) * 100).toFixed(mine === total ? 0 : 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Get tickets"
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-[#fdf6e3] p-6 shadow-2xl sm:rounded-[2rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DogeCoin size={40} />
            <h3 className="display text-2xl font-bold text-amber-950">How many tickets?</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-xl font-bold text-amber-800 hover:bg-amber-200">
            ×
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {bundles.map((b, idx) => {
            const active = idx === k;
            const save = savePct(b, single);
            return (
              <button
                key={idx}
                onClick={() => setSel(idx)}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${
                  active ? "gold-card border-amber-500 shadow-md" : "border-amber-200 bg-white hover:border-amber-400"
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-amber-600" : "border-amber-300"}`}>
                  {active && <span className="h-2.5 w-2.5 rounded-full bg-amber-600" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="display text-lg font-bold text-amber-950">
                    {b.tickets.toLocaleString()} ticket{b.tickets > 1 ? "s" : ""}
                    <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-wider text-amber-600">
                      {tierLabel(b.tickets)}
                    </span>
                  </div>
                  <div className="text-xs text-amber-900/60">{fmt(b.price / BigInt(b.tickets), 1)} DOGE per ticket</div>
                </div>
                <div className="text-right">
                  <div className="display font-bold text-amber-700">{fmt(b.price, 0)} DOGE</div>
                  {save > 0 && <div className="text-xs font-bold text-emerald-600">save {save}%</div>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl bg-white p-4 text-sm text-amber-900/80">
          You&apos;ll hold <b className="text-amber-950">{mine.toLocaleString()}</b> of{" "}
          {total.toLocaleString()} tickets this round — a <b className="text-amber-950">{odds}%</b> chance
          to win if nobody else buys.
        </div>

        <button
          onClick={() => onBuy(k, chosen.price)}
          disabled={disabled}
          className="doge-btn pulse-glow display mt-5 w-full rounded-full bg-amber-500 py-4 text-lg font-bold text-white shadow-lg hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isConnected ? `Buy ${chosen.tickets.toLocaleString()} for ${fmt(chosen.price, 0)} DOGE` : "Connect wallet to buy"}
        </button>
        {status && <div className="mt-3 text-center text-sm">{status}</div>}
      </div>
    </div>
  );
}

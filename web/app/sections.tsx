"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { DogeCoin, WowSeal } from "./doge";

const ZERO = BigInt(0);
const BPS = BigInt(10_000);

export const fmtDoge = (wei: bigint, digits = 2) =>
  Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: digits });

/* ------------------------------------------------------------ countdown */

/** Big D / H / M / S tiles. Renders placeholders until mounted (no hydration drift). */
export function CountdownTiles({ endTime }: { endTime: bigint }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now === null || endTime === ZERO ? null : Math.max(0, Number(endTime) - now);
  const parts =
    left === null
      ? ["–", "–", "–", "–"]
      : [
          Math.floor(left / 86400),
          Math.floor((left % 86400) / 3600),
          Math.floor((left % 3600) / 60),
          left % 60,
        ].map((n) => String(n).padStart(2, "0"));
  const labels = ["days", "hrs", "min", "sec"];
  if (left === 0) {
    return (
      <div className="display rounded-2xl bg-amber-950 px-5 py-4 text-lg font-bold text-amber-300">
        Draw is due — it settles automatically within minutes.
      </div>
    );
  }
  return (
    <div className="flex gap-2 sm:gap-3">
      {parts.map((p, i) => (
        <div
          key={labels[i]}
          className="flex w-16 flex-col items-center rounded-2xl bg-amber-950 py-2 shadow-lg shadow-amber-900/30 sm:w-20"
        >
          <span className="display gold-text text-3xl font-bold tabular-nums sm:text-4xl">{p}</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-200/70">
            {labels[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Tue 1 Dec · 00:00 UTC" — client-only to avoid locale/timezone hydration drift. */
export function DrawDate({ endTime }: { endTime: bigint }) {
  const [label, setLabel] = useState<string>("");
  useEffect(() => {
    if (endTime === ZERO) return;
    const d = new Date(Number(endTime) * 1000);
    setLabel(
      d.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }) + " · 00:00 UTC",
    );
  }, [endTime]);
  return <>{label || "the 1st of next month"}</>;
}

/* ------------------------------------------------------------ section header */

export function SectionHeading({
  id,
  kicker,
  title,
  children,
}: {
  id?: string;
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div id={id} className="mb-8 scroll-mt-24 text-center">
      <div className="display mb-2 inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">
        <DogeCoin size={16} /> {kicker}
      </div>
      <h2 className="display text-4xl font-bold tracking-tight text-amber-950 sm:text-5xl">{title}</h2>
      {children && <p className="mx-auto mt-3 max-w-2xl text-lg text-amber-900/70">{children}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ pot split */

/**
 * Where every DOGE goes. Uses the live pot when there is one; otherwise an
 * illustrative 1,000 DOGE pot (clearly labelled).
 */
export function PotSplit({
  pot,
  feeBps,
  foundationBps,
  bountyWei,
}: {
  pot: bigint;
  feeBps: bigint;
  foundationBps: bigint;
  bountyWei: bigint;
}) {
  const example = pot === ZERO;
  const base = example ? BigInt(1000) * BigInt(10) ** BigInt(18) : pot;
  const protocol = (base * feeBps) / BPS;
  const foundation = (base * foundationBps) / BPS;
  const winner = base - protocol - foundation;
  const bounty = bountyWei < protocol ? bountyWei : protocol;
  const winnerPct = (10_000 - Number(feeBps + foundationBps)) / 100;
  const fPct = Number(foundationBps) / 100;
  const pPct = Number(feeBps) / 100;

  const rows = [
    {
      pct: winnerPct,
      amount: winner,
      title: "The winner",
      color: "bg-gradient-to-r from-amber-400 to-yellow-500",
      dot: "bg-amber-400",
      body: "Paid to the holder of the winning ticket. They claim it from this page with one click and have until the next draw to do it — if they don't, it rolls into the next month's jackpot.",
    },
    {
      pct: fPct,
      amount: foundation,
      title: "Dogecoin Foundation",
      color: "bg-gradient-to-r from-sky-500 to-blue-600",
      dot: "bg-sky-500",
      body: "Sent automatically to the Dogecoin Foundation's wallet at every draw, supporting Dogecoin development. The address is public on-chain and linked in the footer.",
    },
    {
      pct: pPct,
      amount: protocol,
      title: "Protocol",
      color: "bg-gradient-to-r from-stone-600 to-stone-800",
      dot: "bg-stone-700",
      body: `Keeps the lights on: hosting, the draw bot and the randomness oracle. ${fmtDoge(bounty, 0)} DOGE of this goes to whoever triggers the draw, so it always happens on time.`,
    },
  ];

  return (
    <div className="rounded-[2rem] border-2 border-amber-200 bg-white p-6 shadow-xl shadow-amber-100 sm:p-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-amber-600">
            {example ? "Example: a 1,000 DOGE pot" : "This month's pot, right now"}
          </div>
          <div className="display flex items-center gap-3 text-5xl font-bold text-amber-950">
            <DogeCoin size={48} className="coin-flip" />
            {fmtDoge(base, 0)} <span className="text-2xl text-amber-600">DOGE</span>
          </div>
        </div>
        <div className="text-right text-sm text-amber-900/60">
          Split is fixed when a round opens
          <br />
          and enforced by the smart contract.
        </div>
      </div>

      {/* stacked bar */}
      <div className="flex h-14 w-full overflow-hidden rounded-2xl shadow-inner">
        {rows.map((r, i) => (
          <div
            key={r.title}
            className={`${r.color} relative flex items-center justify-center text-sm font-bold text-white`}
            style={{ width: `${r.pct}%`, minWidth: r.pct > 0 ? 52 : 0 }}
            title={`${r.title}: ${r.pct}%`}
          >
            <div className="stripes absolute inset-0" />
            <span className="relative drop-shadow">
              {r.pct}%{i === 0 ? " · winner" : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {rows.map((r, i) => (
          <div
            key={r.title}
            className={`rounded-2xl border-2 p-5 ${i === 0 ? "gold-card border-amber-300" : "border-amber-100 bg-amber-50/40"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${r.dot}`} />
              <span className="display text-lg font-bold text-amber-950">{r.title}</span>
            </div>
            <div className="display mt-2 text-4xl font-bold text-amber-950">{r.pct}%</div>
            <div className="font-semibold text-amber-700">
              {fmtDoge(r.amount)} DOGE{example ? " in the example" : ""}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-amber-900/70">{r.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900/80">
        <b>Rollover bonus:</b> if a winner never claims, their prize is added to the next
        month&apos;s pot and the split above applies to the whole thing — so an unclaimed
        month makes the next jackpot bigger.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ how it works */

const STEPS = [
  {
    title: "Buy tickets",
    body: "Connect any browser wallet and pay in DOGE on DogeOS. Every ticket gets a number — buy 10 and you hold 10 numbers. More tickets, better odds.",
  },
  {
    title: "Draw on the 1st",
    body: "At 00:00 UTC on the 1st of every month, ticket sales close and one ticket number is picked at random. Nobody presses a button — it runs on its own.",
  },
  {
    title: "Winner claims",
    body: "If your number comes up, a claim button appears here. One click sends 90% of the pot to your wallet. You have until the next draw to claim.",
  },
  {
    title: "Next round starts",
    body: "A fresh round opens the moment the draw settles. Unclaimed prizes roll into the new jackpot, so the pot can keep growing.",
  },
];

export function HowItWorks() {
  return (
    <div className="grid gap-5 md:grid-cols-4">
      {STEPS.map((s, i) => (
        <div
          key={s.title}
          className="relative rounded-3xl border-2 border-amber-200 bg-white p-6 pt-10 shadow-lg shadow-amber-100"
        >
          <div className="absolute -top-7 left-6">
            <div className="relative">
              <DogeCoin size={56} className="drop-shadow-md" />
              <span className="display absolute -bottom-1 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-amber-950 text-sm font-bold text-amber-300 ring-2 ring-white">
                {i + 1}
              </span>
            </div>
          </div>
          <h3 className="display text-xl font-bold text-amber-950">{s.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/75">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ fairness */

export function Fairness({ totalTickets }: { totalTickets: bigint }) {
  const n = totalTickets > ZERO ? Number(totalTickets) : 1000;
  return (
    <div className="grid items-center gap-8 rounded-[2rem] bg-amber-950 p-6 text-amber-50 shadow-2xl sm:p-10 md:grid-cols-[1.2fr_1fr]">
      <div>
        <div className="display mb-2 text-sm font-bold uppercase tracking-[0.2em] text-amber-300">
          Provably fair
        </div>
        <h3 className="display text-3xl font-bold sm:text-4xl">How the winner is picked</h3>
        <ol className="mt-5 space-y-4 text-amber-100/85">
          <li>
            <b className="text-amber-300">1. Every ticket has a number.</b> This round&apos;s
            tickets are numbered #0 to #{(n - 1).toLocaleString()}
            {totalTickets === ZERO ? " (example)" : ""}. Yours are listed under My tickets.
          </li>
          <li>
            <b className="text-amber-300">2. A random number is generated on-chain.</b> It comes
            with a cryptographic proof (a VRF) that the smart contract checks before accepting
            it — nobody, including us, can choose or change it.
          </li>
          <li>
            <b className="text-amber-300">3. The number picks the ticket.</b> Winning ticket =
            random number mod total tickets. The contract records the winning number, so anyone
            can check who held it on the block explorer.
          </li>
        </ol>
      </div>
      <div className="relative mx-auto flex flex-col items-center">
        <div className="relative">
          <WowSeal size={170} className="float drop-shadow-2xl" />
        </div>
        <div className="mt-6 w-full rounded-2xl bg-black/30 p-4 font-mono text-sm leading-7 text-amber-200">
          <div>random = VRF(seed) <span className="text-amber-500">// verified on-chain</span></div>
          <div>winner = random % {n.toLocaleString()}</div>
          <div className="text-amber-400">→ ticket #{Math.floor(n * 0.4217).toLocaleString()} wins</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ FAQ */

const FAQ = [
  {
    q: "What do I need to play?",
    a: "A browser wallet (MetaMask, Rabby, Coinbase Wallet and others) or the built-in browser of a mobile wallet app, plus some DOGE on DogeOS. The site will offer to add the DogeOS network to your wallet.",
  },
  {
    q: "How much are tickets?",
    a: "1 ticket is 20 DOGE, 5 are 90 DOGE and 10 are 170 DOGE. Bundles are cheaper per ticket. There is no limit on how many you buy.",
  },
  {
    q: "When is the draw?",
    a: "00:00 UTC on the 1st of every month. Ticket sales for the round close at that moment.",
  },
  {
    q: "How do I know if I won?",
    a: "Connect your wallet and open My tickets. Each past round shows the winning ticket number, who held it, and whether it was you. If you won, a claim button appears at the top of the page.",
  },
  {
    q: "What happens if I win and don't claim?",
    a: "You have until the next draw (about a month). After that, the prize is added to the next month's jackpot.",
  },
  {
    q: "Who holds the money?",
    a: "The smart contract on DogeOS — not us. It enforces the 90 / 5 / 5 split, and nobody can withdraw ticket money or an unclaimed prize. Pausing only stops new ticket sales; claims always work.",
  },
  {
    q: "Is this real money?",
    a: "Not yet — this is running on the DogeOS testnet with free test DOGE. Paid raffles are regulated in many places; real-money launch waits on mainnet and legal clearance.",
  },
];

export function FaqList() {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {FAQ.map((f) => (
        <details
          key={f.q}
          className="group rounded-2xl border-2 border-amber-200 bg-white p-5 shadow-sm open:shadow-lg"
        >
          <summary className="display flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold text-amber-950">
            {f.q}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 transition group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 leading-relaxed text-amber-900/75">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

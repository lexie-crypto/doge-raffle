"use client";

import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import {
  useAccount,
  useConnect,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
} from "wagmi";
import { PrizeStatus, raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";
import Link from "next/link";
import { BundleCarousel, BuyModal } from "./bundles";
import { CoinRain, DogeCoin, DogeOSBadge, Rays, WowSeal } from "./doge";
import { ensureDogeOs, useSafeWrite } from "./use-safe-write";
import { SiteFooter, SiteNav } from "./site-chrome";
import {
  CountdownTiles,
  DrawDate,
  FaqList,
  Fairness,
  HowItWorks,
  PotSplit,
  SectionHeading,
  fmtDoge as fmt,
} from "./sections";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;
const explorer = dogeosChikyu.blockExplorers.default.url;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const BPS = BigInt(10_000);
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function useNowSec() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Live "time left" text for the claim card (client-only). */
function TimeLeft({ until }: { until: bigint }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <>…</>;
  const left = Math.max(0, Number(until) - now);
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  return <>{left === 0 ? "expired" : `${d}d ${h}h ${m}m`}</>;
}


const FACTS = [
  "90% of the pot to the winner",
  "5% to the Dogecoin Foundation",
  "Drawn on the 1st of every month",
  "Verifiable on-chain randomness",
  "Built on DogeOS",
  "Unclaimed prizes roll into the next jackpot",
];

export default function Home() {
  const { address: liveAddress, isConnected: liveConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const nowSec = useNowSec();
  // Wallet state must not influence the first client render (it has to match
  // the server HTML); a wallet that auto-reconnects can otherwise flip
  // isConnected before hydration finishes.
  const mounted = nowSec !== null;
  const isConnected = mounted && liveConnected;
  const address = mounted ? liveAddress : undefined;
  const { write: writeContract, txHash, isPending, error: txError } = useSafeWrite();
  const [claimRecipient, setClaimRecipient] = useState("");
  const { isLoading: txConfirming, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });
  const busy = isPending || txConfirming;

  const { data: roundId, refetch: refetchRoundId } = useReadContract({
    ...raffle,
    functionName: "currentRoundId",
  });

  // The active testnet raffle predates recipient-directed claims. Keep these
  // actions hidden until the site points at a deployed contract with the fix.
  const { data: minClaimWindow } = useReadContract({
    ...raffle,
    functionName: "MIN_CLAIM_WINDOW",
    query: { retry: false },
  });
  const supportsRedirect = minClaimWindow === 7n * 24n * 60n * 60n;

  const { data: round, refetch: refetchRound } = useReadContract({
    ...raffle,
    functionName: "rounds",
    args: roundId !== undefined ? [roundId] : undefined,
    query: { enabled: roundId !== undefined, refetchInterval: 15_000 },
  });

  const { data: guaranteedPot, refetch: refetchGuaranteed } = useReadContract({
    ...raffle,
    functionName: "guaranteedPot",
    query: { refetchInterval: 15_000 },
  });

  const { data: rollover, refetch: refetchRollover } = useReadContract({
    ...raffle,
    functionName: "pendingRollover",
    query: { refetchInterval: 15_000 },
  });

  const { data: bundles } = useReadContract({ ...raffle, functionName: "allBundles" });

  const { data: callerBounty } = useReadContract({ ...raffle, functionName: "callerBounty" });
  const bountyWei = callerBounty ?? BigInt(10) ** BigInt(18);

  const { data: myTickets, refetch: refetchMyTickets } = useReadContract({
    ...raffle,
    functionName: "ticketsOf",
    args: roundId !== undefined && address ? [roundId, address] : undefined,
    query: { enabled: roundId !== undefined && !!address },
  });

  const { data: pendingPayout, refetch: refetchPayout } = useReadContract({
    ...raffle,
    functionName: "withdrawable",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Past rounds + their prizes (newest first, up to 10)
  const pastIds = useMemo(() => {
    if (roundId === undefined) return [];
    const ids: bigint[] = [];
    for (let i = roundId - ONE; i >= ONE && ids.length < 10; i -= ONE) ids.push(i);
    return ids;
  }, [roundId]);

  const { data: pastRounds, refetch: refetchPastRounds } = useReadContracts({
    contracts: pastIds.map((id) => ({
      ...raffle,
      functionName: "rounds" as const,
      args: [id] as const,
    })),
    query: { enabled: pastIds.length > 0 },
  });

  const { data: pastPrizes, refetch: refetchPastPrizes } = useReadContracts({
    contracts: pastIds.map((id) => ({
      ...raffle,
      functionName: "prizeOf" as const,
      args: [id] as const,
    })),
    query: { enabled: pastIds.length > 0 },
  });

  useEffect(() => {
    if (txConfirmed) {
      refetchRound();
      refetchRoundId();
      refetchMyTickets();
      refetchPayout();
      refetchGuaranteed();
      refetchRollover();
      refetchPastRounds();
      refetchPastPrizes();
    }
  }, [
    txConfirmed,
    refetchRound,
    refetchRoundId,
    refetchMyTickets,
    refetchPayout,
    refetchGuaranteed,
    refetchRollover,
    refetchPastRounds,
    refetchPastPrizes,
  ]);

  // rounds tuple: start, end, randomnessBlock, status, feeBps, foundationBps, tickets, pot, winner
  const totalTickets = round?.[6] ?? ZERO;
  const endTime = round?.[1] ?? ZERO;
  const roundFeeBps = BigInt(round?.[4] ?? 500);
  const roundFoundationBps = BigInt(round?.[5] ?? 500);
  const totalFeeBps = roundFeeBps + roundFoundationBps;
  const gPot = guaranteedPot ?? ZERO;
  const guaranteedPrize = gPot - (gPot * totalFeeBps) / BPS;
  const winnerPct = (10_000 - Number(totalFeeBps)) / 100;
  const odds =
    myTickets && totalTickets > ZERO
      ? ((Number(myTickets) / Number(totalTickets)) * 100).toFixed(1)
      : null;

  const [rollAmount, rollCutoff, rollStillClaimable] = rollover ?? [ZERO, ZERO, false];

  // My claimable prize: the prior round, if I won it and it's still live
  const prevId = roundId !== undefined && roundId > ONE ? roundId - ONE : undefined;
  const prevRound = pastRounds?.[0]?.result;
  const prevPrize = pastPrizes?.[0]?.result;
  const myClaim =
    address &&
    prevId !== undefined &&
    prevRound &&
    prevPrize &&
    prevRound[8]?.toLowerCase() === address.toLowerCase() &&
    prevPrize.status === PrizeStatus.Claimable &&
    nowSec !== null &&
    nowSec < Number(prevPrize.claimCutoff)
      ? { roundId: prevId, amount: prevPrize.amount, cutoff: prevPrize.claimCutoff }
      : null;

  const deployed = RAFFLE_ADDRESS !== ZERO_ADDR;

  const [buyOpen, setBuyOpen] = useState(false);

  function buy(bundleIndex: number, price: bigint) {
    if (!isConnected) {
      // one-click path for the common single-wallet case; the header
      // button handles pickers and the no-wallet fallback
      const c = connectors.find((x) => x.id !== "injected") ?? connectors[0];
      if (c)
        connect(
          { connector: c, chainId: dogeosChikyu.id },
          {
            onSuccess: async () => {
              try {
                await ensureDogeOs((await c.getProvider()) as Parameters<typeof ensureDogeOs>[0]);
              } catch {
                /* declined: the purchase will ask again */
              }
            },
          },
        );
      return;
    }
    writeContract({
      ...raffle,
      functionName: "buyTickets",
      args: [BigInt(bundleIndex)],
      value: price,
      chainId: dogeosChikyu.id,
    });
  }

  return (
    <div className="relative overflow-x-hidden">
      <SiteNav />

      {/* ============================================================ HERO */}
      <header
        id="top"
        className="relative overflow-hidden bg-gradient-to-b from-[#fff3c4] via-[#fde9a0] to-[#fdf6e3]"
      >
        <CoinRain count={14} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 md:grid-cols-[1.1fr_1fr] md:pt-16">
          <div className="relative z-10">
            <DogeOSBadge className="mb-5" />
            <h1 className="display text-5xl font-bold leading-[1.02] tracking-tight text-amber-950 sm:text-7xl">
              The monthly
              <br />
              <span className="gold-text gold-shadow">DOGE jackpot.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-amber-900/80">
              Buy tickets with DOGE. On the 1st of every month one ticket wins{" "}
              <b>{winnerPct}% of the pot</b>, {Number(roundFoundationBps) / 100}% goes to the
              Dogecoin Foundation, and every draw is provably fair.
            </p>

            {/* live pot card */}
            <div className="mt-7 rounded-3xl border-2 border-amber-300 bg-white/90 p-5 shadow-2xl shadow-amber-300/40 backdrop-blur sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">
                  Round {roundId?.toString() ?? "…"} · current pot
                </span>
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> live
                </span>
              </div>
              <div className="display mt-1 flex items-center gap-3 text-6xl font-bold text-amber-950 sm:text-7xl">
                <DogeCoin size={56} className="coin-flip shrink-0" />
                <span className="tabular-nums">{fmt(gPot)}</span>
                <span className="text-2xl text-amber-600">DOGE</span>
              </div>
              <div className="mt-1 text-sm text-amber-900/70">
                Winner takes <b className="text-amber-950">{fmt(guaranteedPrize)} DOGE</b> ·{" "}
                {totalTickets.toString()} tickets sold
                {isConnected && (
                  <>
                    {" "}
                    · you hold <b className="text-amber-950">{myTickets?.toString() ?? "0"}</b>
                    {odds ? ` (${odds}% chance)` : ""}
                  </>
                )}
              </div>
              {rollAmount > ZERO && (
                <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  {rollStillClaimable ? (
                    <>
                      ➕ <b>Possible rollover +{fmt(rollAmount)} DOGE</b> if last month&apos;s
                      winner doesn&apos;t claim in time (<TimeLeft until={rollCutoff} /> left).
                    </>
                  ) : (
                    <>
                      ➕ <b>Rollover +{fmt(rollAmount)} DOGE</b> joins this jackpot at the draw.
                    </>
                  )}
                </div>
              )}
              <div className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-amber-600">
                Next draw · <DrawDate endTime={endTime} />
              </div>
              <div className="mt-2">
                <CountdownTiles endTime={endTime} />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => setBuyOpen(true)}
                className="doge-btn pulse-glow display rounded-full bg-amber-500 px-8 py-4 text-lg font-bold text-white shadow-lg hover:bg-amber-400"
              >
                Get tickets
              </button>
              <a
                href="#how"
                className="doge-btn display rounded-full border-2 border-amber-950 bg-white px-8 py-4 text-lg font-bold text-amber-950"
              >
                How it works
              </a>
            </div>
          </div>

          {/* giant doge coin */}
          <div className="relative mx-auto flex aspect-square w-full max-w-[460px] items-center justify-center">
            <Rays size={620} />
            <div className="absolute inset-[12%] rounded-full bg-amber-300/40 blur-3xl" />
            <div className="float relative">
              <DogeCoin size={340} className="relative drop-shadow-[0_25px_35px_rgba(139,101,8,0.45)]" />
            </div>
            {/* orbiting coins */}
            {[
              { r: "205px", d: "16s", s: 46, delay: "0s" },
              { r: "190px", d: "22s", s: 34, delay: "-7s" },
              { r: "215px", d: "28s", s: 28, delay: "-15s" },
            ].map((o, i) => (
              <div
                key={i}
                className="orbit pointer-events-none absolute left-1/2 top-1/2 hidden sm:block"
                style={
                  {
                    "--r": o.r,
                    "--d": o.d,
                    animationDelay: o.delay,
                    marginLeft: -o.s / 2,
                    marginTop: -o.s / 2,
                  } as React.CSSProperties
                }
              >
                <DogeCoin size={o.s} />
              </div>
            ))}
            <div className="absolute -bottom-2 right-0 rotate-12 sm:right-4">
              <WowSeal size={120} className="bob drop-shadow-xl" />
            </div>
          </div>
        </div>
      </header>

      {/* ============================================================ MARQUEE */}
      <div className="overflow-hidden border-y-4 border-amber-400 bg-amber-950 py-3">
        <div className="marquee-track">
          {[0, 1].map((k) => (
            <div key={k} className="flex items-center" aria-hidden={k === 1}>
              {FACTS.map((f) => (
                <span key={f} className="display flex items-center gap-3 px-6 text-lg font-bold text-amber-200">
                  <DogeCoin size={26} />
                  {f}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4">
        {!deployed && (
          <div className="mt-8 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-800">
            Contract not configured — set <code className="font-mono">NEXT_PUBLIC_RAFFLE_ADDRESS</code>{" "}
            in <code className="font-mono">.env.local</code> after deploying.
          </div>
        )}

        {/* ============================================================ CLAIM */}
        {myClaim && (
          <section className="gold-card relative mt-10 overflow-hidden rounded-[2rem] border-4 border-amber-400 p-6 shadow-2xl sm:p-8">
            <CoinRain count={8} />
            <div className="relative flex flex-wrap items-center gap-6">
              <WowSeal size={120} className="float shrink-0 drop-shadow-xl" />
              <div className="min-w-0 flex-1">
                <h2 className="display text-3xl font-bold text-amber-950 sm:text-4xl">
                  You won round {myClaim.roundId.toString()}! 🏆
                </h2>
                <p className="mt-1 text-lg text-amber-950">
                  <b>{fmt(myClaim.amount)} DOGE</b> is waiting for you. Claim within{" "}
                  <b>
                    <TimeLeft until={myClaim.cutoff} />
                  </b>{" "}
                  or it rolls into next month&apos;s jackpot.
                </p>
                <button
                  onClick={() =>
                    writeContract({
                      ...raffle,
                      functionName: "claimPrize",
                      args: [myClaim.roundId],
                      chainId: dogeosChikyu.id,
                    })
                  }
                  disabled={busy}
                  className="doge-btn pulse-glow display mt-4 rounded-full bg-amber-950 px-8 py-3 text-xl font-bold text-amber-300 shadow-lg disabled:opacity-40"
                >
                  Claim {fmt(myClaim.amount)} DOGE
                </button>
                <p className="mt-2 text-xs text-amber-900/70">
                  Sent straight to your wallet — you pay a tiny network fee.
                </p>
                {supportsRedirect && <details className="mt-4 text-sm text-amber-950">
                  <summary className="cursor-pointer font-semibold underline">
                    Claim to another address
                  </summary>
                  <p className="mt-2 max-w-xl text-amber-900/80">
                    If your winning wallet cannot receive DOGE, it can direct its prize to a payable
                    address. Check the address carefully: this transfer cannot be undone.
                  </p>
                  <input
                    aria-label="Prize recipient address"
                    value={claimRecipient}
                    onChange={(event) => setClaimRecipient(event.target.value.trim())}
                    placeholder="0x..."
                    className="mt-2 w-full max-w-md rounded-lg border border-amber-500 bg-white p-2 font-mono text-sm"
                  />
                  <button
                    onClick={() =>
                      writeContract({
                        ...raffle,
                        functionName: "claimPrizeTo",
                        args: [myClaim.roundId, claimRecipient as `0x${string}`],
                        chainId: dogeosChikyu.id,
                      })
                    }
                    disabled={busy || !isAddress(claimRecipient) || claimRecipient === ZERO_ADDR}
                    className="doge-btn mt-2 block rounded-full bg-amber-950 px-5 py-2 font-semibold text-amber-300 disabled:opacity-40"
                  >
                    Claim to this address
                  </button>
                </details>}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ BUY */}
        <section className="pt-20">
          <SectionHeading id="buy" kicker="Tickets" title="Grab your tickets">
            Every ticket is one chance to win. Bundles are cheaper per ticket.
          </SectionHeading>
          <BundleCarousel
            bundles={bundles ?? []}
            isConnected={isConnected}
            disabled={!deployed || busy}
            onBuy={buy}
          />
          {txHash && (
            <p className="mt-5 text-center text-sm">
              {txConfirming ? "Confirming… " : txConfirmed ? "Confirmed ✅ " : ""}
              <a className="font-semibold text-amber-700 underline" href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </p>
          )}
          {txError && (
            <p className="mx-auto mt-5 max-w-xl rounded-xl bg-red-50 p-3 text-center text-sm text-red-700">{txError}</p>
          )}
        </section>

        {/* ============================================================ MY TICKETS LINK */}
        <section className="pt-16">
          <Link
            href="/my-tickets"
            className="doge-btn mx-auto flex max-w-3xl flex-wrap items-center gap-5 rounded-3xl border-2 border-amber-300 bg-white p-6 shadow-lg shadow-amber-100"
          >
            <DogeCoin size={56} className="bob shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="display text-2xl font-bold text-amber-950">My tickets & past draws</div>
              <div className="text-amber-900/70">
                See your ticket numbers, every round you entered, and each draw&apos;s winning ticket.
              </div>
            </div>
            <span className="display rounded-full bg-amber-950 px-5 py-2.5 font-bold text-amber-300">Open →</span>
          </Link>
        </section>

        {/* ============================================================ HOW */}
        <section className="pt-24">
          <SectionHeading id="how" kicker="How it works" title="Four steps. One winner a month.">
            No sign-up, no account — your wallet is your ticket book.
          </SectionHeading>
          <div className="pt-6">
            <HowItWorks />
          </div>
        </section>

        {/* ============================================================ SPLIT */}
        <section className="pt-24">
          <SectionHeading id="split" kicker="Where the pot goes" title="Every DOGE, accounted for">
            Ticket money goes straight into the smart contract. At the draw it&apos;s split three ways —
            the same way, every time, enforced by code.
          </SectionHeading>
          <PotSplit
            pot={gPot}
            feeBps={roundFeeBps}
            foundationBps={roundFoundationBps}
            bountyWei={bountyWei}
          />
        </section>

        {/* ============================================================ FAIRNESS */}
        <section className="pt-24">
          <Fairness totalTickets={totalTickets} />
        </section>

        {/* ============================================================ FAQ */}
        <section className="pb-24 pt-24">
          <SectionHeading id="faq" kicker="FAQ" title="Questions" />
          <FaqList />
        </section>
      </main>

      <SiteFooter />

      <BuyModal
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        bundles={bundles ?? []}
        myTickets={myTickets ?? ZERO}
        totalTickets={totalTickets}
        isConnected={isConnected}
        disabled={!deployed || busy}
        onBuy={buy}
        status={
          txError ? (
            <span className="text-red-700">{txError}</span>
          ) : txHash ? (
            <>
              {txConfirming ? "Confirming… " : txConfirmed ? "Confirmed ✅ Good luck! " : ""}
              <a className="font-semibold text-amber-700 underline" href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </>
          ) : null
        }
      />
    </div>
  );
}

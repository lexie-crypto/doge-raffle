"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { PrizeStatus, raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { CoinRain, DogeCoin, DogeOSBadge, DogeTicker, WowWords } from "./doge";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const BPS = BigInt(10_000);

function fmt(wei: bigint, digits = 2) {
  return Number(formatEther(wei)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

/** Live countdown to a unix-seconds deadline. */
function Countdown({
  endTime,
  doneText,
}: {
  endTime: bigint;
  doneText: string;
}) {
  // null until mounted — Date.now() must not run during prerender
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span>…</span>;
  const left = Math.max(0, Number(endTime) - now);
  if (left === 0) return <span className="text-amber-400">{doneText}</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <span className="tabular-nums">
      {d}d {h}h {m}m {s}s
    </span>
  );
}

function useNowSec() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const nowSec = useNowSec();
  const { writeContract, data: txHash, isPending, error: txError } =
    useWriteContract();
  const { isLoading: txConfirming, isSuccess: txConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const { data: roundId, refetch: refetchRoundId } = useReadContract({
    ...raffle,
    functionName: "currentRoundId",
  });

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

  const { data: bundles } = useReadContract({
    ...raffle,
    functionName: "allBundles",
  });

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
    for (let i = roundId - ONE; i >= ONE && ids.length < 10; i -= ONE)
      ids.push(i);
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

  const totalTickets = round?.[5] ?? ZERO;
  const endTime = round?.[1] ?? ZERO;
  const roundFeeBps = BigInt(round?.[4] ?? 500);
  const gPot = guaranteedPot ?? ZERO;
  const guaranteedPrize = gPot - (gPot * roundFeeBps) / BPS;
  const odds =
    myTickets && totalTickets > ZERO
      ? ((Number(myTickets) / Number(totalTickets)) * 100).toFixed(1)
      : null;

  // Possible (not yet settled) rollover from the prior round's unclaimed prize
  const [rollAmount, rollCutoff, rollStillClaimable] = rollover ?? [
    ZERO,
    ZERO,
    false,
  ];

  // My claimable prize: the prior round, if I won it and it's still live
  const prevId =
    roundId !== undefined && roundId > ONE ? roundId - ONE : undefined;
  const prevRound = pastRounds?.[0]?.result;
  const prevPrize = pastPrizes?.[0]?.result;
  const myClaim =
    address &&
    prevId !== undefined &&
    prevRound &&
    prevPrize &&
    prevRound[7]?.toLowerCase() === address.toLowerCase() &&
    prevPrize.status === PrizeStatus.Claimable &&
    nowSec !== null &&
    nowSec < Number(prevPrize.claimCutoff)
      ? { roundId: prevId, amount: prevPrize.amount, cutoff: prevPrize.claimCutoff }
      : null;

  const deployed =
    RAFFLE_ADDRESS !== "0x0000000000000000000000000000000000000000";

  function prizeStatusLabel(status: number, cutoff: bigint): string {
    if (status === PrizeStatus.Claimed) return "claimed";
    if (status === PrizeStatus.RolledOver) return "unclaimed — rolled into next jackpot";
    if (status === PrizeStatus.Claimable) {
      if (nowSec !== null && nowSec >= Number(cutoff))
        return "expired — rollover pending";
      return "claimable";
    }
    return "";
  }

  return (
    <main className="relative mx-auto max-w-3xl px-4 py-10">
      <WowWords />
      <CoinRain />

      <header className="relative z-10 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <DogeCoin size={72} spin />
          <div>
            <h1 className="doge-speak bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-4xl font-black tracking-tight text-transparent">
              DOGE RAFFLE
            </h1>
            <p className="doge-speak text-sm font-bold text-amber-400/90">
              much jackpot · very 30 days · wow {Number(roundFeeBps) / 100}% fee
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectButton chainStatus="icon" showBalance={false} />
          <DogeOSBadge />
        </div>
      </header>

      <DogeTicker />

      {!deployed && (
        <div className="mb-8 rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-amber-300">
          Contract not configured — set{" "}
          <code className="font-mono">NEXT_PUBLIC_RAFFLE_ADDRESS</code> in{" "}
          <code className="font-mono">.env.local</code> after deploying.
        </div>
      )}

      {/* Winner claim card */}
      {myClaim && (
        <section className="relative z-10 mb-8 rounded-2xl border-4 border-dashed border-amber-400 bg-amber-950/60 p-6">
          <h2 className="doge-speak text-3xl font-black text-amber-300">
            <span className="wiggle">🐕</span> WOW. YOU WIN ROUND{" "}
            {myClaim.roundId.toString()}. SUCH LUCK.
          </h2>
          <p className="mt-1 text-lg">
            <b>{fmt(myClaim.amount)} DOGE</b> is yours — claim it before the
            deadline or it rolls into the next jackpot.
          </p>
          <p className="mt-2 text-sm text-amber-200">
            ⏳ Claim window closes in:{" "}
            <Countdown endTime={myClaim.cutoff} doneText="expired" />
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
            disabled={isPending || txConfirming}
            className="doge-btn doge-speak mt-4 rounded-xl bg-amber-500 px-6 py-3 text-xl font-black text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            🚀 CLAIM {fmt(myClaim.amount)} DOGE WOW
          </button>
          <p className="mt-2 text-xs text-amber-200/70">
            Sent from your wallet — you pay the (tiny) gas.
          </p>
        </section>
      )}

      {/* Current round */}
      <section className="relative z-10 mb-8 overflow-hidden rounded-2xl border-2 border-amber-600/50 bg-zinc-900 p-6">
        <div className="absolute -right-6 -top-6 opacity-20">
          <DogeCoin size={140} />
        </div>
        <div className="doge-speak mb-1 text-sm font-bold uppercase tracking-wide text-amber-500/80">
          round {roundId?.toString() ?? "…"} — such guaranteed pot
        </div>
        <div className="pot-glow doge-speak text-6xl font-black text-amber-400">
          {fmt(gPot)} <span className="text-2xl text-amber-200/70">DOGE</span>
        </div>
        <div className="mt-2 text-sm text-zinc-400">
          Winner takes {fmt(guaranteedPrize)} DOGE after the{" "}
          {Number(roundFeeBps) / 100}% fee · {totalTickets.toString()} tickets
          sold
        </div>
        {rollAmount > ZERO && (
          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 text-sm">
            {rollStillClaimable ? (
              <>
                ➕ <b>Possible rollover: +{fmt(rollAmount)} DOGE</b> — joins
                this jackpot if the previous winner doesn&apos;t claim by{" "}
                <Countdown endTime={rollCutoff} doneText="now (pending settlement)" />
              </>
            ) : (
              <>
                ➕ <b>Rollover eligible: +{fmt(rollAmount)} DOGE</b> — the
                previous prize expired unclaimed and joins this jackpot at the
                draw.
              </>
            )}
          </div>
        )}
        <div className="mt-4 text-lg">
          <span className="doge-speak font-bold text-amber-300">⏳ much wait until draw:</span>{" "}
          <Countdown
            endTime={endTime}
            doneText="Draw pending — anyone can trigger it"
          />
        </div>
        {isConnected && (
          <div className="mt-3 text-sm text-zinc-300">
            <span className="wiggle">🐶</span> You hold{" "}
            <b>{myTickets?.toString() ?? "0"}</b> tickets
            {odds ? (
              <>
                {" "}
                — <span className="doge-speak font-bold text-amber-300">{odds}% such odds</span>
              </>
            ) : (
              ""
            )}
          </div>
        )}
      </section>

      {/* Buy */}
      <section className="relative z-10 mb-8">
        <h2 className="doge-speak mb-3 text-2xl font-black text-amber-300">
          🎟️ buy tickets. very easy. wow.
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(bundles ?? []).map((b, i) => {
            const dogeSpeak = ["such starter", "much value", "very whale 🐋"][i] ?? "wow";
            return (
              <button
                key={i}
                disabled={!isConnected || !deployed || isPending || txConfirming}
                onClick={() =>
                  writeContract({
                    ...raffle,
                    functionName: "buyTickets",
                    args: [BigInt(i)],
                    value: b.price,
                    chainId: dogeosChikyu.id,
                  })
                }
                className="doge-btn rounded-xl border-2 border-amber-700/60 bg-zinc-900 p-5 text-left disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="doge-speak text-xs font-bold text-amber-500/80">{dogeSpeak}</div>
                <div className="flex items-center gap-2 text-2xl font-bold">
                  <DogeCoin size={26} />
                  {b.tickets} ticket{b.tickets > 1 ? "s" : ""}
                </div>
                <div className="doge-speak font-black text-amber-400">
                  {fmt(b.price, 0)} DOGE
                </div>
                {b.tickets > 1 && (
                  <div className="mt-1 text-xs text-zinc-500">
                    {fmt(b.price / BigInt(b.tickets), 1)} DOGE each — much deal
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {!isConnected && (
          <p className="doge-speak mt-2 text-sm font-bold text-amber-500/70">
            connect wallet to buy. such step. very first. 🐕
          </p>
        )}
        {txHash && (
          <p className="mt-2 text-sm">
            {txConfirming ? "Confirming… " : txConfirmed ? "Confirmed ✅ " : ""}
            <a
              className="text-amber-400 underline"
              href={`${dogeosChikyu.blockExplorers.default.url}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              view transaction
            </a>
          </p>
        )}
        {txError && (
          <p className="mt-2 text-sm text-red-400">
            {txError.message.split("\n")[0]}
          </p>
        )}
      </section>

      {/* Failed treasury/bounty payout fallback (rare) */}
      {pendingPayout !== undefined && pendingPayout > ZERO && (
        <section className="mb-8 rounded-2xl border border-emerald-700 bg-emerald-950/40 p-6">
          <h2 className="text-xl font-semibold text-emerald-300">
            You have an unclaimed payout: {fmt(pendingPayout)} DOGE
          </h2>
          <button
            onClick={() =>
              writeContract({
                ...raffle,
                functionName: "withdrawPayout",
                chainId: dogeosChikyu.id,
              })
            }
            disabled={isPending || txConfirming}
            className="mt-3 rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Withdraw
          </button>
        </section>
      )}

      {/* Past rounds */}
      <section className="relative z-10">
        <h2 className="doge-speak mb-3 text-2xl font-black text-amber-300">
          🏆 hall of very fame
        </h2>
        {pastIds.length === 0 && (
          <p className="text-sm text-zinc-500">No completed rounds yet.</p>
        )}
        <ul className="space-y-2">
          {pastRounds?.map((r, i) => {
            if (r.status !== "success") return null;
            const [, , , status, , tickets, , winner] = r.result;
            const prize = pastPrizes?.[i]?.result;
            return (
              <li
                key={pastIds[i].toString()}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm"
              >
                <span className="text-zinc-400">
                  Round {pastIds[i].toString()}
                </span>
                {status === 2 &&
                winner !== "0x0000000000000000000000000000000000000000" &&
                prize ? (
                  <>
                    <a
                      className="font-mono text-amber-400 underline"
                      href={`${dogeosChikyu.blockExplorers.default.url}/address/${winner}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {winner.slice(0, 6)}…{winner.slice(-4)}
                    </a>
                    <span>
                      won {fmt(prize.amount)} DOGE ({tickets.toString()}{" "}
                      tickets)
                    </span>
                    <span className="text-zinc-500">
                      {prizeStatusLabel(prize.status, BigInt(prize.claimCutoff))}
                    </span>
                  </>
                ) : status === 2 ? (
                  <span className="text-zinc-500">no entries — rolled over</span>
                ) : (
                  <span className="text-zinc-500">drawing…</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="relative z-10 mt-12 border-t border-amber-900/40 pt-6 text-xs leading-relaxed text-zinc-500">
        <div className="mb-4 flex items-center justify-center gap-3">
          <DogeCoin size={32} />
          <span className="doge-speak text-base font-black text-amber-400">
            powered by DogeOS — the Dogecoin app layer
          </span>
          <DogeCoin size={32} />
        </div>
        Winners claim their own prize (and pay gas) before a fixed deadline —
        unclaimed prizes roll into the next jackpot, where the protocol fee
        applies to the full gross pot including rolled funds. Draws are
        permissionless: once the countdown hits zero anyone can call{" "}
        <code>commitDraw()</code> then <code>finalizeDraw()</code> and earn a 1
        DOGE bounty from the fee. Randomness comes from a block hash pinned
        after sales close (interim scheme — see repo for the trust model).
        Testnet only — this is not an offer to gamble; paid raffles are
        regulated in many jurisdictions.
      </footer>
    </main>
  );
}

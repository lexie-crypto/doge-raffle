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
import { DogeCoin, DogeOSBadge, ShibaFace } from "./doge";

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
  if (left === 0) return <span className="text-amber-600">{doneText}</span>;
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
    if (status === PrizeStatus.RolledOver)
      return "unclaimed — rolled into next jackpot";
    if (status === PrizeStatus.Claimable) {
      if (nowSec !== null && nowSec >= Number(cutoff))
        return "expired — rollover pending";
      return "claimable";
    }
    return "";
  }

  return (
    <main className="relative mx-auto max-w-3xl px-4 py-10">
      <header className="relative z-10 mb-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bob">
            <ShibaFace size={88} />
          </div>
          <div>
            <h1 className="display text-5xl font-bold tracking-tight text-amber-950">
              Doge Raffle
            </h1>
            <p className="font-medium text-amber-800/80">
              A winner every 30 days · {Number(roundFeeBps) / 100}% protocol
              fee · verifiable on-chain draws
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectButton chainStatus="icon" showBalance={false} />
          <DogeOSBadge />
        </div>
      </header>

      {!deployed && (
        <div className="mb-8 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-800">
          Contract not configured — set{" "}
          <code className="font-mono">NEXT_PUBLIC_RAFFLE_ADDRESS</code> in{" "}
          <code className="font-mono">.env.local</code> after deploying.
        </div>
      )}

      {/* Winner claim card */}
      {myClaim && (
        <section className="relative z-10 mb-8 rounded-3xl border-2 border-amber-400 bg-gradient-to-br from-amber-100 to-yellow-50 p-6 shadow-lg">
          <h2 className="display text-3xl font-bold text-amber-900">
            🏆 You won round {myClaim.roundId.toString()}!
          </h2>
          <p className="mt-1 text-lg text-amber-950">
            <b>{fmt(myClaim.amount)} DOGE</b> is yours — claim it before the
            deadline or it rolls into the next jackpot.
          </p>
          <p className="mt-2 text-sm font-semibold text-amber-800">
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
            className="doge-btn display mt-4 rounded-full bg-amber-500 px-8 py-3 text-xl font-bold text-white shadow-md hover:bg-amber-400 disabled:opacity-40"
          >
            Claim {fmt(myClaim.amount)} DOGE
          </button>
          <p className="mt-2 text-xs text-amber-700">
            Sent from your wallet — you pay the (tiny) gas.
          </p>
        </section>
      )}

      {/* Current round */}
      <section className="relative z-10 mb-8 overflow-hidden rounded-3xl border-2 border-amber-200 bg-white p-6 shadow-xl shadow-amber-100">
        <div className="absolute -right-5 -top-5 opacity-15">
          <DogeCoin size={150} />
        </div>
        <div className="display mb-1 text-sm font-semibold uppercase tracking-wider text-amber-600">
          Round {roundId?.toString() ?? "…"} — current pot
        </div>
        <div className="pot-glow display text-7xl font-bold text-amber-500">
          {fmt(gPot)} <span className="text-3xl text-amber-400">DOGE</span>
        </div>
        <div className="mt-2 text-sm text-stone-500">
          Winner takes {fmt(guaranteedPrize)} DOGE after the{" "}
          {Number(roundFeeBps) / 100}% fee · {totalTickets.toString()} tickets
          sold
        </div>
        {rollAmount > ZERO && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {rollStillClaimable ? (
              <>
                ➕ <b>Possible rollover: +{fmt(rollAmount)} DOGE</b> — joins
                this jackpot if the previous winner doesn&apos;t claim by{" "}
                <Countdown
                  endTime={rollCutoff}
                  doneText="now (pending settlement)"
                />
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
          <span className="display font-semibold text-amber-700">
            ⏳ Next draw in:
          </span>{" "}
          <Countdown
            endTime={endTime}
            doneText="Draw pending — anyone can trigger it"
          />
        </div>
        {isConnected && (
          <div className="mt-3 text-sm text-stone-600">
            You hold <b>{myTickets?.toString() ?? "0"}</b> tickets
            {odds ? (
              <>
                {" "}
                —{" "}
                <span className="font-semibold text-amber-700">
                  {odds}% win chance
                </span>
              </>
            ) : (
              ""
            )}
          </div>
        )}
      </section>

      {/* Buy */}
      <section className="relative z-10 mb-8">
        <h2 className="display mb-3 text-2xl font-bold text-amber-950">
          Buy tickets
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(bundles ?? []).map((b, i) => {
            const tierLabel = ["Starter", "Popular", "Best value"][i] ?? "";
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
                className="doge-btn rounded-2xl border-2 border-amber-200 bg-white p-5 text-left shadow-md shadow-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="display text-xs font-semibold uppercase tracking-wider text-amber-600">
                  {tierLabel}
                </div>
                <div className="flex items-center gap-2 text-2xl font-bold text-amber-950">
                  <DogeCoin size={26} />
                  {b.tickets} ticket{b.tickets > 1 ? "s" : ""}
                </div>
                <div className="display font-bold text-amber-600">
                  {fmt(b.price, 0)} DOGE
                </div>
                {b.tickets > 1 && (
                  <div className="mt-1 text-xs text-stone-500">
                    {fmt(b.price / BigInt(b.tickets), 1)} DOGE each
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {!isConnected && (
          <p className="mt-2 text-sm text-stone-500">
            Connect a wallet to buy tickets.
          </p>
        )}
        {txHash && (
          <p className="mt-2 text-sm">
            {txConfirming ? "Confirming… " : txConfirmed ? "Confirmed ✅ " : ""}
            <a
              className="text-amber-600 underline"
              href={`${dogeosChikyu.blockExplorers.default.url}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              view transaction
            </a>
          </p>
        )}
        {txError && (
          <p className="mt-2 text-sm text-red-600">
            {txError.message.split("\n")[0]}
          </p>
        )}
      </section>

      {/* Failed treasury/bounty payout fallback (rare) */}
      {pendingPayout !== undefined && pendingPayout > ZERO && (
        <section className="relative z-10 mb-8 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6">
          <h2 className="text-xl font-semibold text-emerald-800">
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
            className="doge-btn mt-3 rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Withdraw
          </button>
        </section>
      )}

      {/* Past rounds */}
      <section className="relative z-10">
        <h2 className="display mb-3 text-2xl font-bold text-amber-950">
          Past winners
        </h2>
        {pastIds.length === 0 && (
          <p className="text-sm text-stone-500">No completed rounds yet.</p>
        )}
        <ul className="space-y-2">
          {pastRounds?.map((r, i) => {
            if (r.status !== "success") return null;
            const [, , , status, , tickets, , winner] = r.result;
            const prize = pastPrizes?.[i]?.result;
            return (
              <li
                key={pastIds[i].toString()}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-amber-100 bg-white px-4 py-3 text-sm shadow-sm"
              >
                <span className="text-stone-500">
                  Round {pastIds[i].toString()}
                </span>
                {status === 2 &&
                winner !== "0x0000000000000000000000000000000000000000" &&
                prize ? (
                  <>
                    <a
                      className="font-mono text-amber-600 underline"
                      href={`${dogeosChikyu.blockExplorers.default.url}/address/${winner}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {winner.slice(0, 6)}…{winner.slice(-4)}
                    </a>
                    <span className="text-amber-950">
                      won {fmt(prize.amount)} DOGE ({tickets.toString()}{" "}
                      tickets)
                    </span>
                    <span className="text-stone-400">
                      {prizeStatusLabel(prize.status, BigInt(prize.claimCutoff))}
                    </span>
                  </>
                ) : status === 2 ? (
                  <span className="text-stone-400">
                    no entries — rolled over
                  </span>
                ) : (
                  <span className="text-stone-400">drawing…</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="relative z-10 mt-12 border-t-2 border-amber-100 pt-6 text-xs leading-relaxed text-stone-400">
        <div className="mb-4 flex items-center justify-center gap-3">
          <ShibaFace size={40} />
          <span className="display text-base font-bold text-amber-700">
            Powered by DogeOS — the Dogecoin app layer
          </span>
          <DogeCoin size={28} />
        </div>
        Winners claim their own prize (and pay gas) before a fixed deadline —
        unclaimed prizes roll into the next jackpot, where the protocol fee
        applies to the full gross pot including rolled funds. Draws are
        permissionless: once the countdown hits zero anyone can call{" "}
        <code>commitDraw()</code> then <code>finalizeDraw()</code> and earn a 1
        DOGE bounty from the fee. Draw randomness is verified on-chain (VRF)
        with a block-hash fallback — see the repo for the full trust model.
        Testnet only — this is not an offer to gamble; paid raffles are
        regulated in many jurisdictions.
      </footer>
    </main>
  );
}

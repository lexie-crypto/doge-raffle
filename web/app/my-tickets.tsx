"use client";

import { useMemo } from "react";
import { formatEther } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { PrizeStatus, raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { DogeCoin } from "./doge";
import Link from "next/link";
import { SectionHeading } from "./sections";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const MAX_ENTRIES_SCANNED = 2000; // per round; beyond this we show counts only

const fmt = (wei: bigint) =>
  Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** "#4" or "#12–#21" */
function rangeLabel(first: bigint, last: bigint) {
  return first === last ? `#${first}` : `#${first}–#${last}`;
}

type RoundTickets = {
  roundId: bigint;
  count: bigint;
  ranges: { first: bigint; last: bigint }[];
  scannedAll: boolean;
};

/**
 * Everything a connected wallet owns or has owned, read straight from the
 * contract (no indexer): which rounds it entered, exact ticket numbers,
 * the winning ticket of each finished round, and the outcome.
 */
export function MyTickets({
  nowSec,
  onClaim,
  busy,
  onGetTickets,
}: {
  nowSec: number | null;
  onClaim: (roundId: bigint) => void;
  busy: boolean;
  /** Opens the ticket picker on the current page (falls back to a link). */
  onGetTickets?: () => void;
}) {
  const { address: liveAddress, isConnected: liveConnected } = useAccount();
  // same hydration guard as the page: no wallet-dependent output until mounted
  const mounted = nowSec !== null;
  const isConnected = mounted && liveConnected;
  const address = mounted ? liveAddress : undefined;

  const { data: currentRoundId } = useReadContract({
    ...raffle,
    functionName: "currentRoundId",
  });

  // All round ids, newest first.
  const roundIds = useMemo(() => {
    const ids: bigint[] = [];
    if (currentRoundId === undefined) return ids;
    for (let i = currentRoundId; i >= ONE; i -= ONE) ids.push(i);
    return ids;
  }, [currentRoundId]);

  // 1) how many tickets I hold in each round
  const { data: counts } = useReadContracts({
    contracts: roundIds.map((id) => ({
      ...raffle,
      functionName: "ticketsOf" as const,
      args: [id, address ?? "0x0000000000000000000000000000000000000000"] as const,
    })),
    query: { enabled: !!address && roundIds.length > 0, refetchInterval: 20_000 },
  });

  const enteredRounds = useMemo(
    () =>
      roundIds.filter((_, i) => {
        const r = counts?.[i];
        return r?.status === "success" && (r.result as bigint) > ZERO;
      }),
    [roundIds, counts],
  );

  // 2) per entered round: round record, prize record, winning ticket, entry count
  const { data: roundMeta } = useReadContracts({
    contracts: enteredRounds.flatMap((id) => [
      { ...raffle, functionName: "rounds" as const, args: [id] as const },
      { ...raffle, functionName: "prizeOf" as const, args: [id] as const },
      { ...raffle, functionName: "winningTicketOf" as const, args: [id] as const },
      { ...raffle, functionName: "entryCount" as const, args: [id] as const },
    ]),
    query: { enabled: enteredRounds.length > 0, refetchInterval: 20_000 },
  });

  // 3) scan every purchase in those rounds (multicall-batched) to find my ranges
  const entryCalls = useMemo(() => {
    const calls: { roundId: bigint; index: bigint }[] = [];
    enteredRounds.forEach((id, i) => {
      const ec = roundMeta?.[i * 4 + 3];
      if (ec?.status !== "success") return;
      const n = Number(ec.result as bigint);
      for (let k = 0; k < Math.min(n, MAX_ENTRIES_SCANNED); k++) {
        calls.push({ roundId: id, index: BigInt(k) });
      }
    });
    return calls;
  }, [enteredRounds, roundMeta]);

  const { data: entries } = useReadContracts({
    contracts: entryCalls.map((c) => ({
      ...raffle,
      functionName: "entryAt" as const,
      args: [c.roundId, c.index] as const,
    })),
    query: { enabled: entryCalls.length > 0, refetchInterval: 20_000 },
  });

  const tickets: RoundTickets[] = useMemo(() => {
    if (!address) return [];
    return enteredRounds.map((id, i) => {
      const count = (counts?.[roundIds.indexOf(id)]?.result as bigint) ?? ZERO;
      const ec = roundMeta?.[i * 4 + 3];
      const n = ec?.status === "success" ? Number(ec.result as bigint) : 0;
      const ranges: { first: bigint; last: bigint }[] = [];
      entryCalls.forEach((c, k) => {
        if (c.roundId !== id) return;
        const e = entries?.[k];
        if (e?.status !== "success") return;
        const [buyer, first, last] = e.result as [string, bigint, bigint];
        if (buyer.toLowerCase() === address.toLowerCase()) ranges.push({ first, last });
      });
      return { roundId: id, count, ranges, scannedAll: n <= MAX_ENTRIES_SCANNED };
    });
  }, [address, enteredRounds, counts, roundIds, roundMeta, entryCalls, entries]);

  if (!isConnected) {
    return (
      <div>
        <SectionHeading kicker="Your tickets" title="Current & past tickets" />
        <div className="mx-auto flex max-w-xl flex-col items-center rounded-3xl border-2 border-dashed border-amber-300 bg-white/60 p-8 text-center">
          <DogeCoin size={64} className="bob" />
          <p className="display mt-3 text-xl font-bold text-amber-950">Connect your wallet to see your tickets</p>
          <p className="mt-1 text-amber-900/70">
            Your ticket numbers, every round you entered, each draw&apos;s winning
            ticket and whether you won. Your wallet is your account — nothing to sign up for.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="relative z-10">
      <SectionHeading kicker="Your tickets" title="Current & past tickets" />
      {counts === undefined && (
        <p className="text-center text-amber-900/60">Loading your tickets…</p>
      )}
      {counts !== undefined && tickets.length === 0 && (
        <div className="mx-auto flex max-w-xl flex-col items-center rounded-3xl border-2 border-dashed border-amber-300 bg-white/60 p-8 text-center">
          <DogeCoin size={64} className="bob" />
          <p className="display mt-3 text-2xl font-bold text-amber-950">No tickets purchased yet</p>
          <p className="mt-1 text-amber-900/70">
            Get yours now — the next draw is on the 1st of the month.
          </p>
          {onGetTickets ? (
            <button
              onClick={onGetTickets}
              className="doge-btn pulse-glow display mt-5 rounded-full bg-amber-500 px-7 py-3 text-lg font-bold text-white shadow-lg hover:bg-amber-400"
            >
              Get tickets
            </button>
          ) : (
            <Link
              href="/#buy"
              className="doge-btn pulse-glow display mt-5 rounded-full bg-amber-500 px-7 py-3 text-lg font-bold text-white shadow-lg hover:bg-amber-400"
            >
              Get tickets
            </Link>
          )}
        </div>
      )}
      <ul className="mx-auto max-w-4xl space-y-3">
        {tickets.map((t, i) => {
          const round = roundMeta?.[i * 4]?.result as
            | readonly [bigint, bigint, bigint, number, number, number, bigint, bigint, string]
            | undefined;
          const prize = roundMeta?.[i * 4 + 1]?.result as
            | { amount: bigint; claimCutoff: bigint; status: number }
            | undefined;
          const winningTicket = roundMeta?.[i * 4 + 2]?.result as bigint | undefined;
          const status = round?.[3];
          const totalTickets = round?.[6] ?? ZERO;
          const winner = round?.[8];
          const isCurrent = t.roundId === currentRoundId;
          const finished = status === 2 && winner && winner !== "0x0000000000000000000000000000000000000000";
          const iWon = finished && winner!.toLowerCase() === address!.toLowerCase();
          const claimable =
            iWon &&
            prize?.status === PrizeStatus.Claimable &&
            nowSec !== null &&
            nowSec < Number(prize.claimCutoff);
          const odds =
            totalTickets > ZERO ? ((Number(t.count) / Number(totalTickets)) * 100).toFixed(1) : null;

          return (
            <li
              key={t.roundId.toString()}
              className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${
                iWon ? "border-amber-400" : "border-amber-100"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="display text-lg font-bold text-amber-950">
                  Round {t.roundId.toString()}
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      live
                    </span>
                  )}
                </div>
                <div className="text-sm text-stone-500">
                  {t.count.toString()} ticket{t.count === ONE ? "" : "s"}
                  {odds ? ` · ${odds}% of ${totalTickets.toString()}` : ""}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.ranges.map((r) => (
                  <span
                    key={r.first.toString()}
                    className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-xs text-amber-900"
                  >
                    {rangeLabel(r.first, r.last)}
                  </span>
                ))}
                {!t.scannedAll && (
                  <span className="text-xs text-stone-400">(large round — numbers truncated)</span>
                )}
              </div>

              {finished && winningTicket !== undefined && (
                <div className="mt-3 text-sm">
                  Winning ticket{" "}
                  <span className="font-mono font-semibold text-amber-900">
                    #{winningTicket.toString()}
                  </span>{" "}
                  —{" "}
                  {iWon ? (
                    <span className="font-bold text-amber-700">that&apos;s yours. You won {fmt(prize!.amount)} DOGE.</span>
                  ) : (
                    <>
                      held by{" "}
                      <a
                        className="font-mono text-amber-600 underline"
                        href={`${dogeosChikyu.blockExplorers.default.url}/address/${winner}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {winner!.slice(0, 6)}…{winner!.slice(-4)}
                      </a>
                      . Not this time.
                    </>
                  )}
                </div>
              )}
              {isCurrent && (
                <div className="mt-3 text-sm text-stone-500">Draw pending — good luck.</div>
              )}
              {status === 1 && (
                <div className="mt-3 text-sm text-stone-500">Drawing now…</div>
              )}

              {iWon && prize && (
                <div className="mt-2 text-sm">
                  {prize.status === PrizeStatus.Claimed && (
                    <span className="text-emerald-700">Prize claimed ✓</span>
                  )}
                  {prize.status === PrizeStatus.RolledOver && (
                    <span className="text-stone-500">Unclaimed — rolled into the next jackpot.</span>
                  )}
                  {claimable && (
                    <button
                      onClick={() => onClaim(t.roundId)}
                      disabled={busy}
                      className="doge-btn display mt-1 rounded-full bg-amber-500 px-5 py-2 font-bold text-white hover:bg-amber-400 disabled:opacity-40"
                    >
                      Claim {fmt(prize.amount)} DOGE
                    </button>
                  )}
                  {iWon &&
                    prize.status === PrizeStatus.Claimable &&
                    !claimable && (
                      <span className="text-stone-500">Claim window closed — rollover pending.</span>
                    )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

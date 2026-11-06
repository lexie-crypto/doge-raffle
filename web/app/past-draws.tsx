"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { PrizeStatus, raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { WowSeal } from "./doge";
import { DrawDate, SectionHeading } from "./sections";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;
const explorer = dogeosChikyu.blockExplorers.default.url;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ONE = BigInt(1);
const fmt = (wei: bigint) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Every finished round, newest first: prize, winning ticket number, winner, claim status. */
export function PastDraws({ limit = 24 }: { limit?: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Math.floor(Date.now() / 1000)), []);

  const { data: roundId } = useReadContract({ ...raffle, functionName: "currentRoundId" });
  const { data: current } = useReadContract({
    ...raffle,
    functionName: "rounds",
    args: roundId !== undefined ? [roundId] : undefined,
    query: { enabled: roundId !== undefined },
  });
  const ids = useMemo(() => {
    const out: bigint[] = [];
    if (roundId === undefined) return out;
    for (let i = roundId - ONE; i >= ONE && out.length < limit; i -= ONE) out.push(i);
    return out;
  }, [roundId, limit]);

  const { data } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...raffle, functionName: "rounds" as const, args: [id] as const },
      { ...raffle, functionName: "prizeOf" as const, args: [id] as const },
      { ...raffle, functionName: "winningTicketOf" as const, args: [id] as const },
    ]),
    query: { enabled: ids.length > 0, refetchInterval: 30_000 },
  });

  function statusLabel(status: number, cutoff: bigint) {
    if (status === PrizeStatus.Claimed) return "claimed";
    if (status === PrizeStatus.RolledOver) return "unclaimed — rolled into the next jackpot";
    if (status === PrizeStatus.Claimable)
      return now !== null && now >= Number(cutoff) ? "expired — rollover pending" : "awaiting claim";
    return "";
  }

  return (
    <div>
      <SectionHeading id="draws" kicker="Hall of fame" title="Past draws">
        Every draw&apos;s winning ticket number, recorded on-chain.
      </SectionHeading>
      {ids.length === 0 ? (
        <div className="mx-auto flex max-w-xl flex-col items-center rounded-3xl border-2 border-dashed border-amber-300 bg-white/60 p-8 text-center">
          <WowSeal size={90} className="bob" />
          <p className="display mt-3 text-xl font-bold text-amber-950">The first draw is coming up</p>
          <p className="mt-1 text-amber-900/70">
            <DrawDate endTime={current?.[1] ?? BigInt(0)} /> — winners will be listed here.
          </p>
        </div>
      ) : (
        <ul className="mx-auto max-w-4xl space-y-3">
          {ids.map((id, i) => {
            const r = data?.[i * 3]?.result as
              | readonly [bigint, bigint, bigint, number, number, number, bigint, bigint, string]
              | undefined;
            const prize = data?.[i * 3 + 1]?.result as { amount: bigint; claimCutoff: bigint; status: number } | undefined;
            const winning = data?.[i * 3 + 2]?.result as bigint | undefined;
            if (!r) return null;
            const [, , , status, , , tickets, , winner] = r;
            const won = status === 2 && winner !== ZERO_ADDR && prize;
            return (
              <li key={id.toString()} className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-amber-200 bg-white p-4 shadow-sm">
                <div className="display flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-amber-950 text-amber-300">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-amber-300/70">round</span>
                  <span className="text-xl font-bold leading-none">{id.toString()}</span>
                </div>
                {won ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="display text-xl font-bold text-amber-950">{fmt(prize.amount)} DOGE</div>
                      <div className="text-sm text-amber-900/70">
                        won by{" "}
                        <a className="font-mono text-amber-700 underline" href={`${explorer}/address/${winner}`} target="_blank" rel="noreferrer">
                          {short(winner)}
                        </a>{" "}
                        · {statusLabel(prize.status, BigInt(prize.claimCutoff))}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-amber-50 px-4 py-2 text-center">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600">winning ticket</div>
                      <div className="display font-mono text-2xl font-bold text-amber-950">#{winning?.toString() ?? "?"}</div>
                      <div className="text-[10px] text-amber-900/60">of {tickets.toLocaleString()}</div>
                    </div>
                  </>
                ) : (
                  <div className="text-amber-900/60">{status === 2 ? "No tickets sold — rolled over" : "Drawing…"}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

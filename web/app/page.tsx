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
import { raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const FEE_BPS = BigInt(500);
const BPS = BigInt(10_000);

function fmt(wei: bigint, digits = 2) {
  return Number(formatEther(wei)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function Countdown({ endTime }: { endTime: bigint }) {
  // null until mounted — Date.now() must not run during prerender
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span>…</span>;
  const left = Math.max(0, Number(endTime) - now);
  if (left === 0)
    return <span className="text-amber-400">Draw pending — anyone can trigger it</span>;
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

export default function Home() {
  const { address, isConnected } = useAccount();
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

  const { data: bundles } = useReadContract({
    ...raffle,
    functionName: "allBundles",
  });

  const { data: myTickets, refetch: refetchMyTickets } = useReadContract({
    ...raffle,
    functionName: "ticketsOf",
    args:
      roundId !== undefined && address ? [roundId, address] : undefined,
    query: { enabled: roundId !== undefined && !!address },
  });

  const { data: pending, refetch: refetchPending } = useReadContract({
    ...raffle,
    functionName: "withdrawable",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Past winners: read finished rounds directly (newest first, up to 10).
  const pastIds = useMemo(() => {
    if (roundId === undefined) return [];
    const ids: bigint[] = [];
    for (let i = roundId - ONE; i >= ONE && ids.length < 10; i -= ONE) ids.push(i);
    return ids;
  }, [roundId]);

  const { data: pastRounds } = useReadContracts({
    contracts: pastIds.map((id) => ({
      ...raffle,
      functionName: "rounds" as const,
      args: [id] as const,
    })),
    query: { enabled: pastIds.length > 0 },
  });

  useEffect(() => {
    if (txConfirmed) {
      refetchRound();
      refetchRoundId();
      refetchMyTickets();
      refetchPending();
    }
  }, [txConfirmed, refetchRound, refetchRoundId, refetchMyTickets, refetchPending]);

  const pot = round?.[5] ?? ZERO;
  const totalTickets = round?.[4] ?? ZERO;
  const endTime = round?.[1] ?? ZERO;
  const prizeAfterFee = pot - (pot * FEE_BPS) / BPS;
  const odds =
    myTickets && totalTickets > ZERO
      ? ((Number(myTickets) / Number(totalTickets)) * 100).toFixed(1)
      : null;

  const deployed =
    RAFFLE_ADDRESS !== "0x0000000000000000000000000000000000000000";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            🐕 Doge Raffle
          </h1>
          <p className="text-sm text-zinc-400">
            DogeOS Chikyū testnet · a winner every 30 days · 5% protocol fee
          </p>
        </div>
        <ConnectButton chainStatus="icon" showBalance={false} />
      </header>

      {!deployed && (
        <div className="mb-8 rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-amber-300">
          Contract not configured — set{" "}
          <code className="font-mono">NEXT_PUBLIC_RAFFLE_ADDRESS</code> in{" "}
          <code className="font-mono">.env.local</code> after deploying.
        </div>
      )}

      {/* Current round */}
      <section className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-1 text-sm uppercase tracking-wide text-zinc-500">
          Round {roundId?.toString() ?? "…"} — current pot
        </div>
        <div className="text-5xl font-bold text-amber-400">
          {fmt(pot)} <span className="text-2xl text-zinc-400">DOGE</span>
        </div>
        <div className="mt-2 text-sm text-zinc-400">
          Winner takes {fmt(prizeAfterFee)} DOGE after the 5% fee ·{" "}
          {totalTickets.toString()} tickets sold
        </div>
        <div className="mt-4 text-lg">
          ⏳ Next draw in: <Countdown endTime={endTime} />
        </div>
        {isConnected && (
          <div className="mt-3 text-sm text-zinc-300">
            You hold <b>{myTickets?.toString() ?? "0"}</b> tickets
            {odds ? ` — ${odds}% chance of winning` : ""}
          </div>
        )}
      </section>

      {/* Buy */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">Buy tickets</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(bundles ?? []).map((b, i) => (
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
              className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-left transition hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="text-2xl font-bold">
                {b.tickets} ticket{b.tickets > 1 ? "s" : ""}
              </div>
              <div className="text-amber-400">{fmt(b.price, 0)} DOGE</div>
              {b.tickets > 1 && (
                <div className="mt-1 text-xs text-zinc-500">
                  {fmt(b.price / BigInt(b.tickets), 1)} DOGE each
                </div>
              )}
            </button>
          ))}
        </div>
        {!isConnected && (
          <p className="mt-2 text-sm text-zinc-500">
            Connect a wallet to buy tickets.
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

      {/* Claim fallback */}
      {pending !== undefined && pending > ZERO && (
        <section className="mb-8 rounded-2xl border border-emerald-700 bg-emerald-950/40 p-6">
          <h2 className="text-xl font-semibold text-emerald-300">
            🎉 You have an unclaimed payout: {fmt(pending)} DOGE
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
            Claim payout
          </button>
        </section>
      )}

      {/* Past winners */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Past winners</h2>
        {pastIds.length === 0 && (
          <p className="text-sm text-zinc-500">No completed rounds yet.</p>
        )}
        <ul className="space-y-2">
          {pastRounds?.map((r, i) => {
            if (r.status !== "success") return null;
            const [, , , status, tickets, roundPot, winner, prize] = r.result;
            return (
              <li
                key={pastIds[i].toString()}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm"
              >
                <span className="text-zinc-400">
                  Round {pastIds[i].toString()}
                </span>
                {status === 2 && winner !== "0x0000000000000000000000000000000000000000" ? (
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
                      won {fmt(prize)} DOGE ({tickets.toString()} tickets,{" "}
                      {fmt(roundPot)} pot)
                    </span>
                  </>
                ) : status === 2 ? (
                  <span className="text-zinc-500">
                    no entries — rolled over
                  </span>
                ) : (
                  <span className="text-zinc-500">drawing…</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="mt-12 border-t border-zinc-800 pt-6 text-xs leading-relaxed text-zinc-500">
        Draws are permissionless: once the countdown hits zero anyone can call{" "}
        <code>commitDraw()</code> then <code>finalizeDraw()</code> and earn a 1
        DOGE bounty. Randomness comes from a block hash pinned after sales
        close. Testnet only — this is not an offer to gamble; paid raffles are
        regulated in many jurisdictions.
      </footer>
    </main>
  );
}

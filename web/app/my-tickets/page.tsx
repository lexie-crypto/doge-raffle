"use client";

import { useEffect, useState } from "react";
import { formatEther, isAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { DogeCoin } from "../doge";
import { GetTicketsModal } from "../get-tickets-modal";
import { MyTickets } from "../my-tickets";
import { PastDraws } from "../past-draws";
import { SiteFooter, SiteNav } from "../site-chrome";
import { useSafeWrite } from "../use-safe-write";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;
const explorer = dogeosChikyu.blockExplorers.default.url;

export default function MyTicketsPage() {
  const [nowSec, setNowSec] = useState<number | null>(null);
  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(t);
  }, []);
  const { address: liveAddress } = useAccount();
  const address = nowSec !== null ? liveAddress : undefined;
  const { write, txHash, isPending, error } = useSafeWrite();
  const [payoutRecipient, setPayoutRecipient] = useState("");
  const [buyOpen, setBuyOpen] = useState(false);

  // Recipient-directed withdrawals only exist on raffle contracts deployed
  // with the fund-safety fix; keep the option hidden until the site points
  // at one (same gate as the landing page's claim-to-address option).
  const { data: minClaimWindow } = useReadContract({
    ...raffle,
    functionName: "MIN_CLAIM_WINDOW",
    query: { retry: false },
  });
  const supportsRedirect = minClaimWindow === BigInt(7 * 24 * 60 * 60);

  const { data: pendingPayout } = useReadContract({
    ...raffle,
    functionName: "withdrawable",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return (
    <div className="relative overflow-x-hidden">
      <SiteNav />
      <header className="border-b-4 border-amber-400 bg-amber-950 text-amber-50">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-10">
          <DogeCoin size={72} className="bob shrink-0" />
          <div>
            <div className="display text-sm font-bold uppercase tracking-[0.2em] text-amber-300">Your account</div>
            <h1 className="display text-4xl font-bold sm:text-5xl">My tickets</h1>
            <p className="mt-1 text-amber-100/75">Your ticket numbers, every round you entered, and every past draw.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="pt-14">
          <MyTickets
            nowSec={nowSec}
            busy={isPending}
            onClaim={(id) => write({ ...raffle, functionName: "claimPrize", args: [id], chainId: dogeosChikyu.id })}
            onGetTickets={() => setBuyOpen(true)}
          />
          {pendingPayout !== undefined && pendingPayout > BigInt(0) && (
            <div className="mx-auto mt-4 max-w-4xl rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5">
              <div className="font-semibold text-emerald-800">
                You have {Number(formatEther(pendingPayout)).toLocaleString()} DOGE waiting from a payout that
                couldn&apos;t be sent automatically.
              </div>
              <button
                onClick={() => write({ ...raffle, functionName: "withdrawPayout", chainId: dogeosChikyu.id })}
                disabled={isPending}
                className="doge-btn mt-3 rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white disabled:opacity-40"
              >
                Withdraw
              </button>
              {supportsRedirect && (
                <details className="mt-3 text-sm text-emerald-900">
                  <summary className="cursor-pointer font-semibold underline">Withdraw to another address</summary>
                  <p className="mt-2">Use this if your wallet rejects an incoming DOGE transfer.</p>
                  <input
                    aria-label="Payout recipient address"
                    value={payoutRecipient}
                    onChange={(event) => setPayoutRecipient(event.target.value.trim())}
                    placeholder="0x..."
                    className="mt-2 w-full max-w-md rounded-lg border border-emerald-500 bg-white p-2 font-mono text-sm"
                  />
                  <button
                    onClick={() =>
                      write({
                        ...raffle,
                        functionName: "withdrawPayoutTo",
                        args: [payoutRecipient as `0x${string}`],
                        chainId: dogeosChikyu.id,
                      })
                    }
                    disabled={
                      isPending ||
                      !isAddress(payoutRecipient) ||
                      payoutRecipient === "0x0000000000000000000000000000000000000000"
                    }
                    className="doge-btn mt-2 block rounded-full bg-emerald-700 px-5 py-2 font-semibold text-white disabled:opacity-40"
                  >
                    Withdraw to this address
                  </button>
                </details>
              )}
            </div>
          )}
          {txHash && (
            <p className="mt-4 text-center text-sm">
              <a className="font-semibold text-amber-700 underline" href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </p>
          )}
          {error && <p className="mx-auto mt-4 max-w-xl rounded-xl bg-red-50 p-3 text-center text-sm text-red-700">{error}</p>}
        </section>

        <section className="scroll-mt-24 pb-24 pt-20">
          <PastDraws />
        </section>
      </main>
      <SiteFooter />
      <GetTicketsModal open={buyOpen} onClose={() => setBuyOpen(false)} />
    </div>
  );
}

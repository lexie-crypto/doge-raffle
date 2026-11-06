"use client";

import { useAccount, useReadContract } from "wagmi";
import { raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { BuyModal } from "./bundles";
import { useBuyTickets } from "./use-buy-tickets";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;
const explorer = dogeosChikyu.blockExplorers.default.url;
const ZERO = BigInt(0);

/** The ticket picker popup with everything it needs — drop it on any page. */
export function GetTicketsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, isConnected } = useAccount();
  const { buy, txHash, error, busy, confirming, confirmed } = useBuyTickets();
  const { data: bundles } = useReadContract({ ...raffle, functionName: "allBundles" });
  const { data: roundId } = useReadContract({ ...raffle, functionName: "currentRoundId" });
  const { data: round } = useReadContract({
    ...raffle,
    functionName: "rounds",
    args: roundId !== undefined ? [roundId] : undefined,
    query: { enabled: roundId !== undefined },
  });
  const { data: myTickets } = useReadContract({
    ...raffle,
    functionName: "ticketsOf",
    args: roundId !== undefined && address ? [roundId, address] : undefined,
    query: { enabled: roundId !== undefined && !!address },
  });

  return (
    <BuyModal
      open={open}
      onClose={onClose}
      bundles={bundles ?? []}
      myTickets={myTickets ?? ZERO}
      totalTickets={round?.[6] ?? ZERO}
      isConnected={isConnected}
      disabled={busy}
      onBuy={buy}
      status={
        error ? (
          <span className="text-red-700">{error}</span>
        ) : txHash ? (
          <>
            {confirming ? "Confirming… " : confirmed ? "Confirmed ✅ Good luck! " : ""}
            <a className="font-semibold text-amber-700 underline" href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
              view transaction
            </a>
          </>
        ) : null
      }
    />
  );
}

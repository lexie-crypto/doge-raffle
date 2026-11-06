"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAccount, useConnect, useWaitForTransactionReceipt } from "wagmi";
import { raffleAbi } from "@/lib/abi";
import { RAFFLE_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { ensureDogeOs, useSafeWrite } from "./use-safe-write";

const raffle = { address: RAFFLE_ADDRESS, abi: raffleAbi } as const;

/**
 * Buying tickets, shared by every page: connects first if needed (and asks
 * the wallet for DogeOS), sends buyTickets, tracks the receipt, and refreshes
 * all on-chain reads once the purchase confirms.
 */
export function useBuyTickets() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { write, txHash, isPending, error } = useSafeWrite();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (confirmed) queryClient.invalidateQueries();
  }, [confirmed, queryClient]);

  function buy(bundleIndex: number, price: bigint) {
    if (!isConnected) {
      // one-click path for the common single-wallet case; the navbar button
      // handles wallet pickers and the no-wallet fallback
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
    write({
      ...raffle,
      functionName: "buyTickets",
      args: [BigInt(bundleIndex)],
      value: price,
      chainId: dogeosChikyu.id,
    });
  }

  return { buy, txHash, error, busy: isPending || confirming, confirming, confirmed };
}

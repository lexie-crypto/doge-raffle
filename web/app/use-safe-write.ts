"use client";

import { useState } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { dogeosChikyu } from "@/lib/chain";

// wagmi's writeContract parameters are generic over the ABI; TypeScript can't
// extract them through ReturnType, so accept them as given (wagmi still
// validates them when it encodes the call).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WriteParams = any;

/** Walk an error and its causes for an EIP-1193 / JSON-RPC error code. */
function errorCode(e: unknown): number | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "number") return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 4100: the wallet hasn't authorized this site for the method/account/network.
const isUnauthorized = (e: unknown) =>
  errorCode(e) === 4100 || /not been authorized/i.test(text(e));
const isRejected = (e: unknown) =>
  errorCode(e) === 4001 || /user (rejected|denied)/i.test(text(e));

function friendly(e: unknown): string {
  if (isRejected(e)) return "Transaction cancelled in your wallet.";
  if (isUnauthorized(e))
    return "Your wallet hasn't allowed this site to use the DogeOS network. In your wallet's connected-sites settings, enable DogeOS Chikyū Testnet for this site, then try again.";
  if (/insufficient funds/i.test(text(e)))
    return "Not enough DOGE in your wallet to cover this plus the network fee.";
  const short = (e as { shortMessage?: string }).shortMessage;
  return (short ?? text(e)).split("\n")[0];
}

/**
 * writeContract with one automatic recovery: if the wallet answers 4100
 * (e.g. MetaMask's per-site network permissions don't include DogeOS), ask
 * it to re-grant permissions — which prompts the user — switch to DogeOS,
 * and retry once. Errors come back as plain-English strings.
 */
export function useSafeWrite() {
  const { connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const w = useWriteContract();
  const [error, setError] = useState<string | null>(null);

  async function write(params: WriteParams) {
    setError(null);
    try {
      return await w.writeContractAsync(params);
    } catch (e) {
      if (!isUnauthorized(e) || !connector) {
        setError(friendly(e));
        return;
      }
      try {
        const provider = (await connector.getProvider()) as {
          request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
        await provider.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
        await switchChainAsync({ chainId: dogeosChikyu.id }).catch(() => undefined);
        return await w.writeContractAsync(params);
      } catch (e2) {
        setError(friendly(e2));
      }
    }
  }

  return { write, txHash: w.data, isPending: w.isPending, error };
}

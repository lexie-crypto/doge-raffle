"use client";

import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { dogeosChikyu } from "@/lib/chain";

// wagmi's writeContract parameters are generic over the ABI; TypeScript can't
// extract them through ReturnType, so accept them as given (wagmi still
// validates them when it encodes the call).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WriteParams = any;

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

const CHAIN_HEX = `0x${dogeosChikyu.id.toString(16)}`;

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
const isUnauthorized = (e: unknown) => errorCode(e) === 4100 || /not been authorized/i.test(text(e));
const isRejected = (e: unknown) => errorCode(e) === 4001 || /user (rejected|denied)/i.test(text(e));

function friendly(e: unknown): string {
  if (isRejected(e)) return "Transaction cancelled in your wallet.";
  if (isUnauthorized(e))
    return "Your wallet didn't authorize this site on the DogeOS network. Disconnect, reconnect and approve DogeOS Chikyū Testnet when your wallet asks.";
  if (/insufficient funds/i.test(text(e)))
    return "Not enough DOGE in your wallet to cover this plus the network fee.";
  const short = (e as { shortMessage?: string }).shortMessage;
  return (short ?? text(e)).split("\n")[0];
}

/**
 * Ask the wallet to switch to DogeOS directly on the provider (not through
 * wagmi, which skips the call when it already believes the chain matches).
 * Wallets with per-site network permissions (MetaMask) grant this site
 * DogeOS as part of this request; if the wallet doesn't know the network yet
 * it is added first (4902).
 */
export async function ensureDogeOs(provider: Eip1193) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (errorCode(e) !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: dogeosChikyu.name,
          nativeCurrency: dogeosChikyu.nativeCurrency,
          rpcUrls: dogeosChikyu.rpcUrls.default.http,
          blockExplorerUrls: [dogeosChikyu.blockExplorers.default.url],
        },
      ],
    });
  }
}

/**
 * writeContract that makes sure the wallet has authorized this site on DogeOS
 * before sending, and recovers once from a 4100 "not authorized" refusal by
 * re-requesting the network and account permissions. Errors are returned as
 * plain-English strings.
 */
export function useSafeWrite() {
  const { connector, chainId } = useAccount();
  const w = useWriteContract();
  const [error, setError] = useState<string | null>(null);

  async function write(params: WriteParams) {
    setError(null);
    const provider = connector ? ((await connector.getProvider()) as Eip1193) : undefined;
    try {
      if (provider && chainId !== dogeosChikyu.id) await ensureDogeOs(provider);
      return await w.writeContractAsync(params);
    } catch (e) {
      if (!isUnauthorized(e) || !provider) {
        setError(friendly(e));
        return;
      }
      try {
        await ensureDogeOs(provider);
        try {
          return await w.writeContractAsync(params);
        } catch (e2) {
          if (!isUnauthorized(e2)) throw e2;
          await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
          await ensureDogeOs(provider);
          return await w.writeContractAsync(params);
        }
      } catch (e3) {
        setError(friendly(e3));
      }
    }
  }

  return { write, txHash: w.data, isPending: w.isPending, error };
}

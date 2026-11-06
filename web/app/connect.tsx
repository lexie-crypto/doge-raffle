"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { dogeosChikyu } from "@/lib/chain";

/**
 * Connect button for browser wallets (extensions + mobile in-app browsers).
 * - one wallet installed: connects directly
 * - several (EIP-6963): shows a picker
 * - none (plain mobile Safari/Chrome): explains how to open the page inside
 *   a wallet app, with deep links
 * - connected on the wrong network: offers to add/switch to DogeOS
 */
export function ConnectWallet() {
  // useAccount().chainId is the wallet's REAL chain (undefined/other when it
  // is on a network we don't support); useChainId() would always report a
  // configured chain and never flag a mismatch.
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const connectors = useConnectors();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Drop the generic "Injected" catch-all when EIP-6963 found named wallets.
  const named = connectors.filter((c) => c.id !== "injected");
  const choices = named.length > 0 ? named : connectors;
  const hasWallet =
    mounted && typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum;

  if (!mounted) {
    return (
      <button className="whitespace-nowrap rounded-full bg-amber-500 px-4 py-2.5 text-sm font-bold text-white opacity-60 sm:px-5 sm:text-base">
        Connect wallet
      </button>
    );
  }

  if (isConnected && address) {
    const wrongChain = chainId !== dogeosChikyu.id;
    return (
      <div className="flex items-center gap-2">
        {wrongChain && (
          <button
            onClick={() => switchChain({ chainId: dogeosChikyu.id })}
            disabled={switching}
            className="doge-btn rounded-full bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {switching ? "Switching…" : "Switch to DogeOS"}
          </button>
        )}
        <span className="rounded-full border-2 border-amber-300 bg-white px-3 py-1.5 font-mono text-sm text-amber-900">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="text-sm font-semibold text-stone-500 underline hover:text-stone-700"
        >
          disconnect
        </button>
      </div>
    );
  }

  const dappUrl =
    typeof window !== "undefined" ? window.location.host + window.location.pathname : "";

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!hasWallet) return setOpen(true);
          if (choices.length === 1) return connect({ connector: choices[0] });
          setOpen(true);
        }}
        disabled={isPending}
        className="doge-btn whitespace-nowrap rounded-full bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-amber-400 disabled:opacity-50 sm:px-5 sm:text-base"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="display text-xl font-bold text-amber-950">Connect a wallet</h3>
            {hasWallet ? (
              <ul className="mt-4 space-y-2">
                {choices.map((c) => (
                  <li key={c.uid}>
                    <button
                      onClick={() => {
                        connect({ connector: c });
                        setOpen(false);
                      }}
                      className="doge-btn flex w-full items-center gap-3 rounded-xl border-2 border-amber-100 px-4 py-3 text-left font-semibold text-amber-950 hover:border-amber-400"
                    >
                      {c.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.icon} alt="" className="h-7 w-7 rounded-md" />
                      )}
                      {c.name === "Injected" ? "Browser wallet" : c.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 text-sm text-stone-600">
                <p>
                  No wallet detected in this browser. On desktop, install a
                  wallet extension (MetaMask, Rabby, Coinbase Wallet…). On
                  mobile, open this page inside your wallet app&apos;s browser:
                </p>
                <ul className="mt-3 space-y-2">
                  <li>
                    <a
                      className="doge-btn block rounded-xl border-2 border-amber-100 px-4 py-3 font-semibold text-amber-950 hover:border-amber-400"
                      href={`https://metamask.app.link/dapp/${dappUrl}`}
                    >
                      Open in MetaMask
                    </a>
                  </li>
                  <li>
                    <a
                      className="doge-btn block rounded-xl border-2 border-amber-100 px-4 py-3 font-semibold text-amber-950 hover:border-amber-400"
                      href={`https://go.cb-w.com/dapp?cb_url=https://${dappUrl}`}
                    >
                      Open in Coinbase Wallet
                    </a>
                  </li>
                  <li>
                    <a
                      className="doge-btn block rounded-xl border-2 border-amber-100 px-4 py-3 font-semibold text-amber-950 hover:border-amber-400"
                      href={`https://link.trustwallet.com/open_url?url=https://${dappUrl}`}
                    >
                      Open in Trust Wallet
                    </a>
                  </li>
                </ul>
                <p className="mt-3 text-xs text-stone-400">
                  Any wallet with a built-in browser works — paste the page URL
                  into it.
                </p>
              </div>
            )}
            {error && <p className="mt-3 text-sm text-red-600">{error.message.split("\n")[0]}</p>}
            <button
              onClick={() => setOpen(false)}
              className="mt-4 w-full text-sm font-semibold text-stone-500 underline"
            >
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

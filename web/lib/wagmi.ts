"use client";

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { dogeosChikyu } from "./chain";

/**
 * Browser wallets only — every extension (MetaMask, Rabby, Coinbase Wallet,
 * Phantom, …) and every mobile wallet's in-app browser inject the same
 * EIP-1193 provider. wagmi's EIP-6963 discovery (on by default) lists each
 * installed wallet as its own connector; `injected()` is the catch-all for
 * anything that only sets window.ethereum. No WalletConnect, no project id.
 */
export const wagmiConfig = createConfig({
  chains: [dogeosChikyu],
  connectors: [injected()],
  // batch: many parallel reads become one JSON-RPC request — the public
  // DogeOS RPC rate-limits unbatched bursts (429).
  transports: { [dogeosChikyu.id]: http(undefined, { batch: true }) },
  ssr: true,
});

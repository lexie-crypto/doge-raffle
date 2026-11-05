"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { dogeosChikyu } from "./chain";

export const wagmiConfig = getDefaultConfig({
  appName: "Doge Raffle",
  // WalletConnect Cloud project id — set a real one in .env for production.
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "doge-raffle-dev",
  chains: [dogeosChikyu],
  transports: { [dogeosChikyu.id]: http() },
  ssr: true,
});

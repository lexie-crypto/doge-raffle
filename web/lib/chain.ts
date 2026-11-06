import { defineChain } from "viem";

/** DogeOS Chikyū testnet — native gas token is DOGE. */
export const dogeosChikyu = defineChain({
  id: 6281971,
  name: "DogeOS Chikyū Testnet",
  nativeCurrency: { name: "Dogecoin", symbol: "DOGE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.dogeos.com/"] },
  },
  blockExplorers: {
    default: { name: "L2Scan", url: "https://dogeos-testnet.l2scan.co" },
  },
  contracts: {
    // Multicall3 is deployed at the canonical address on DogeOS; lets wagmi
    // batch many reads into one RPC call.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

/** Set after deployment (see contracts/script/Deploy.s.sol). */
export const RAFFLE_ADDRESS = (process.env.NEXT_PUBLIC_RAFFLE_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/** DogeOS VRF coordinator (randomness service). */
export const VRF_COORDINATOR_ADDRESS = (process.env.NEXT_PUBLIC_VRF_COORDINATOR_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

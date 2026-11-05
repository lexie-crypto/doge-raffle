// Draw-keeper backstop for DogeRaffle on DogeOS Chikyu testnet.
//
// The draw is permissionless (anyone can call commitDraw/finalizeDraw and
// earn the bounty); this bot just guarantees it happens on schedule even if
// nobody else calls. Run it on a cron (see .github/workflows/draw-bot.yml).
//
// Env:
//   RAFFLE_ADDRESS     - deployed DogeRaffle address
//   BOT_PRIVATE_KEY    - hot wallet key holding a little testnet DOGE for gas
//   RPC_URL            - optional, defaults to the Chikyu testnet RPC

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.RPC_URL ?? "https://rpc.testnet.dogeos.com/";
const RAFFLE_ADDRESS = process.env.RAFFLE_ADDRESS;
const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;

if (!RAFFLE_ADDRESS || !BOT_PRIVATE_KEY) {
  console.error("RAFFLE_ADDRESS and BOT_PRIVATE_KEY are required");
  process.exit(1);
}

const dogeosChikyu = defineChain({
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: { name: "Dogecoin", symbol: "DOGE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const abi = parseAbi([
  "function canCommit() view returns (bool)",
  "function canFinalize() view returns (bool)",
  "function commitDraw()",
  "function finalizeDraw()",
]);

const account = privateKeyToAccount(BOT_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: dogeosChikyu, transport: http() });
const walletClient = createWalletClient({ account, chain: dogeosChikyu, transport: http() });

const raffle = { address: RAFFLE_ADDRESS, abi };

async function send(functionName) {
  const { request } = await publicClient.simulateContract({
    ...raffle,
    functionName,
    account,
  });
  const hash = await walletClient.writeContract(request);
  console.log(`${functionName} sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`${functionName} ${receipt.status} in block ${receipt.blockNumber}`);
  return receipt.status === "success";
}

async function main() {
  if (await publicClient.readContract({ ...raffle, functionName: "canCommit" })) {
    await send("commitDraw");
    // randomness block is ~10 blocks out; a later cron run will finalize,
    // but try waiting briefly in case blocks are fast
    await new Promise((r) => setTimeout(r, 60_000));
  }

  if (await publicClient.readContract({ ...raffle, functionName: "canFinalize" })) {
    await send("finalizeDraw");
    // finalize may have re-committed if the hash window expired; a later
    // cron run picks that up — nothing more to do now.
  } else {
    console.log("nothing to do");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

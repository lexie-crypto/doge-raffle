// Draw-keeper backstop for DogeRaffle on DogeOS Chikyu testnet.
//
// The draw is permissionless (anyone can call commitDraw/finalizeDraw and
// earn the bounty); this bot guarantees it happens on schedule even if nobody
// else calls. GitHub Actions cron is best-effort, so eventual execution is
// promised only while a funded bot (or any independent caller) submits
// transactions. Run on a cron (see .github/workflows/draw-bot.yml).
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

// Overall run budget: well under the workflow's timeout so a wedged RPC
// never piles up concurrent runs.
const RUN_DEADLINE_MS = 6 * 60 * 1000;
const startedAt = Date.now();
const timeLeft = () => RUN_DEADLINE_MS - (Date.now() - startedAt);

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
  "function currentRoundId() view returns (uint256)",
  "function rounds(uint256) view returns (uint64 startTime, uint64 endTime, uint64 randomnessBlock, uint8 status, uint16 feeBps, uint16 foundationBps, uint96 totalTickets, uint256 pot, address winner)",
  "function canCommit() view returns (bool)",
  "function canFinalize() view returns (bool)",
  "function commitDraw()",
  "function finalizeDraw()",
]);

const account = privateKeyToAccount(BOT_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: dogeosChikyu, transport: http() });
const walletClient = createWalletClient({ account, chain: dogeosChikyu, transport: http() });
const raffle = { address: RAFFLE_ADDRESS, abi };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (functionName, args = []) =>
  publicClient.readContract({ ...raffle, functionName, args });

/// Send a state-changing call, tolerating competing permissionless callers:
/// simulation failure after the state already advanced is success, not error.
async function send(functionName, recheck) {
  try {
    const { request } = await publicClient.simulateContract({
      ...raffle,
      functionName,
      account,
    });
    const hash = await walletClient.writeContract(request);
    console.log(`${functionName} sent: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
    console.log(`${functionName}: ${receipt.status} in block ${receipt.blockNumber}`);
    return receipt.status === "success";
  } catch (err) {
    // A competitor may have landed the call first (nonce race, or the
    // simulate now reverts because the step is done). If the goal state is
    // reached, treat as success.
    if (recheck && (await recheck())) {
      console.log(`${functionName}: already done by a competing caller`);
      return true;
    }
    console.error(`${functionName} failed:`, err.shortMessage ?? err.message);
    return false;
  }
}

async function roundState() {
  const id = await read("currentRoundId");
  const r = await read("rounds", [id]);
  return { id, status: r[3], randomnessBlock: r[2] }; // tuple: start,end,randBlock,status,feeBps,foundationBps,tickets,pot,winner
}

async function main() {
  // Step 1: commit if due (also settles expired prize / rolls empty rounds).
  if (await read("canCommit")) {
    const before = await roundState();
    const ok = await send("commitDraw", async () => !(await read("canCommit")));
    if (!ok) process.exit(1);
    const after = await roundState();
    if (after.id > before.id) {
      console.log(`empty round ${before.id} rolled over; round ${after.id} open`);
      return;
    }
  }

  // Step 2: poll until the pinned randomness block is usable, then finalize
  // promptly inside the 256-block hash window. finalizeDraw may only re-pin
  // (never selects a winner on a stale hash); observe the new target and
  // retry within this run's bounded budget.
  let attempts = 0;
  while (timeLeft() > 30_000 && attempts < 10) {
    const st = await roundState();
    if (st.status !== 1 /* Committed */) break; // nothing pending or already finalized

    const blockNumber = await publicClient.getBlockNumber();
    if (blockNumber <= st.randomnessBlock) {
      const blocksLeft = Number(st.randomnessBlock - blockNumber) + 1;
      console.log(`waiting for randomness block (${blocksLeft} blocks)…`);
      await sleep(Math.min(15_000, blocksLeft * 3_000));
      continue;
    }

    attempts++;
    const stBefore = st;
    await send("finalizeDraw", async () => {
      const now = await roundState();
      return now.id > stBefore.id || now.status !== 1;
    });

    const now = await roundState();
    if (now.id > stBefore.id) {
      console.log(`round ${stBefore.id} finalized; round ${now.id} open`);
      return;
    }
    if (now.randomnessBlock > stBefore.randomnessBlock) {
      console.log(
        `hash window missed — re-pinned to block ${now.randomnessBlock}, retrying`,
      );
      continue;
    }
    await sleep(5_000);
  }

  // Alert path: if a committed round is still unresolved, fail the run so
  // the workflow shows red and the next cron picks it up.
  const final = await roundState();
  if (final.status === 1) {
    console.error(`round ${final.id} still committed/unresolved at run end`);
    process.exit(1);
  }
  console.log("nothing to do");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

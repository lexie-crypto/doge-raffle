// VRF oracle responder for DogeVRFCoordinator on DogeOS.
//
// Finds unfulfilled randomness requests, generates an ECVRF proof for each
// with the oracle secret key, and submits fulfill(). Anyone can deliver a
// valid proof, but only the key holder can produce one.
//
// Requests are found by walking request ids (the coordinator numbers them
// 1..lastRequestId), not by log queries — DogeOS RPCs cap eth_getLogs at a
// 10,000-block range, and ids need no range at all.
//
// Modes:
//   node vrf-oracle.mjs            one pass, then exit (cron / CI)
//   node vrf-oracle.mjs --watch    stay running and answer new requests within
//                                  seconds (run this on an always-on host for
//                                  third-party consumers)
//
// Env:
//   COORDINATOR_ADDRESS  - deployed DogeVRFCoordinator
//   VRF_SECRET_KEY       - the ECVRF secret key (matches the registered pubkey)
//   ORACLE_PRIVATE_KEY   - tx-signing hot wallet (gas only; may differ from VRF key)
//   RPC_URL              - optional
//   SCAN_BATCH           - request ids read per pass/page (default 500)
//   POLL_MS              - watch-mode poll interval (default 3000)

import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prove } from "./ecvrf.mjs";

const RPC_URL = process.env.RPC_URL ?? "https://rpc.testnet.dogeos.com/";
const { COORDINATOR_ADDRESS, VRF_SECRET_KEY, ORACLE_PRIVATE_KEY } = process.env;
const SCAN_BATCH = BigInt(process.env.SCAN_BATCH ?? process.env.LOOKBACK ?? "500");
const POLL_MS = Number(process.env.POLL_MS ?? "3000");
const WATCH = process.argv.includes("--watch");

if (!COORDINATOR_ADDRESS || !VRF_SECRET_KEY || !ORACLE_PRIVATE_KEY) {
  console.error("COORDINATOR_ADDRESS, VRF_SECRET_KEY and ORACLE_PRIVATE_KEY are required");
  process.exit(1);
}
if (SCAN_BATCH < 1n) throw new Error("SCAN_BATCH must be positive");

const chain = defineChain({
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: { name: "Dogecoin", symbol: "DOGE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const abi = parseAbi([
  "function lastRequestId() view returns (uint256)",
  "function pendingRequest(uint256 requestId) view returns (address consumer, uint64 requestedAt, bool fulfilled, uint256 seed)",
  "struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }",
  "function fulfill(Proof calldata proof, uint256 requestId)",
]);

const account = privateKeyToAccount(ORACLE_PRIVATE_KEY);
const pub = createPublicClient({ chain, transport: http(undefined, { batch: true }) });
const wallet = createWalletClient({ account, chain, transport: http() });
const coordinator = { address: COORDINATOR_ADDRESS, abi };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function proofToTuple(proof) {
  return {
    pk: proof.pk,
    gamma: proof.gamma,
    c: proof.c,
    s: proof.s,
    seed: proof.seed,
    uWitness: "0x" + proof.uWitness.toString(16).padStart(40, "0"),
    cGammaWitness: proof.cGammaWitness,
    sHashWitness: proof.sHashWitness,
    zInv: proof.zInv,
  };
}

// Watch mode walks every request id in rotating pages. Cron mode scans all
// pages in one pass. Neither mode permanently skips an old paid request.
let scanCursor = 1n;

async function pendingIds() {
  const last = await pub.readContract({ ...coordinator, functionName: "lastRequestId" });
  if (last === 0n) return [];
  const from = WATCH && scanCursor <= last ? scanCursor : 1n;
  const through = WATCH && from + SCAN_BATCH - 1n < last ? from + SCAN_BATCH - 1n : last;
  if (WATCH) scanCursor = through + 1n;

  const pending = [];
  for (let start = from; start <= through; start += SCAN_BATCH) {
    const stop = start + SCAN_BATCH - 1n < through ? start + SCAN_BATCH - 1n : through;
    const ids = [];
    for (let id = start; id <= stop; id++) ids.push(id);
    const res = await pub.multicall({
      contracts: ids.map((id) => ({ ...coordinator, functionName: "pendingRequest", args: [id] })),
    });
    pending.push(
      ...ids
        .map((id, i) => ({ id, r: res[i] }))
        .filter(({ r }) => r.status === "success" && r.result[0] !== "0x0000000000000000000000000000000000000000" && !r.result[2])
        .map(({ id, r }) => ({ id, seed: r.result[3] })),
    );
  }
  return pending;
}

async function fulfillOne({ id, seed }) {
  try {
    const proof = prove(BigInt(VRF_SECRET_KEY), seed);
    const { request } = await pub.simulateContract({
      ...coordinator,
      functionName: "fulfill",
      args: [proofToTuple(proof), id],
      account,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    console.log(`fulfill(${id}): ${receipt.status} in block ${receipt.blockNumber} (${hash})`);
    return receipt.status === "success";
  } catch (err) {
    const [, , nowFulfilled] = await pub.readContract({
      ...coordinator,
      functionName: "pendingRequest",
      args: [id],
    });
    if (nowFulfilled) {
      console.log(`request ${id} already fulfilled by someone else`);
      return true;
    }
    console.error(`fulfill(${id}) failed:`, err.shortMessage ?? err.message);
    return false;
  }
}

async function pass() {
  const pending = await pendingIds();
  if (pending.length) console.log(`${pending.length} pending request(s): ${pending.map((p) => p.id).join(", ")}`);
  let failures = 0;
  for (const p of pending) if (!(await fulfillOne(p))) failures++;
  return { pending: pending.length, failures };
}

async function main() {
  if (!WATCH) {
    const { pending, failures } = await pass();
    console.log(pending ? `done (${failures} failed)` : "no pending requests");
    if (failures) process.exit(1);
    return;
  }
  console.log(`watching ${COORDINATOR_ADDRESS} every ${POLL_MS}ms as ${account.address}`);
  for (;;) {
    try {
      await pass();
    } catch (err) {
      console.error("poll error:", err.shortMessage ?? err.message);
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

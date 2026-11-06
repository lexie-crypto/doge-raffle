// VRF oracle responder for DogeVRFCoordinator on DogeOS Chikyu testnet.
//
// Scans recent RandomnessRequested events, generates an ECVRF proof for each
// unfulfilled request with the oracle secret key, and submits fulfill().
// Anyone can deliver a valid proof, but only the key holder can produce one.
// Run on the same cron as the draw bot.
//
// Env:
//   COORDINATOR_ADDRESS  - deployed DogeVRFCoordinator
//   VRF_SECRET_KEY       - the ECVRF secret key (matches the registered pubkey)
//   ORACLE_PRIVATE_KEY   - tx-signing hot wallet (gas only; may differ from VRF key)
//   RPC_URL              - optional
//   SCAN_BLOCKS          - how far back to scan for requests (default 20000)

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeProof, prove } from "./ecvrf.mjs";

const RPC_URL = process.env.RPC_URL ?? "https://rpc.testnet.dogeos.com/";
const COORDINATOR_ADDRESS = process.env.COORDINATOR_ADDRESS;
const VRF_SECRET_KEY = process.env.VRF_SECRET_KEY;
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
const SCAN_BLOCKS = BigInt(process.env.SCAN_BLOCKS ?? "20000");

if (!COORDINATOR_ADDRESS || !VRF_SECRET_KEY || !ORACLE_PRIVATE_KEY) {
  console.error(
    "COORDINATOR_ADDRESS, VRF_SECRET_KEY and ORACLE_PRIVATE_KEY are required",
  );
  process.exit(1);
}

const dogeosChikyu = defineChain({
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: { name: "Dogecoin", symbol: "DOGE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const abi = parseAbi([
  "event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint256 seed)",
  "function pendingRequest(uint256 requestId) view returns (address consumer, uint64 requestedAt, bool fulfilled, uint256 seed)",
  "struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }",
  "function fulfill(Proof calldata proof, uint256 requestId)",
]);

const account = privateKeyToAccount(ORACLE_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: dogeosChikyu, transport: http() });
const walletClient = createWalletClient({ account, chain: dogeosChikyu, transport: http() });
const coordinator = { address: COORDINATOR_ADDRESS, abi };

function proofToTuple(proof) {
  // viem wants the struct as an object matching the ABI components order
  const addr = "0x" + proof.uWitness.toString(16).padStart(40, "0");
  return {
    pk: [proof.pk[0], proof.pk[1]],
    gamma: [proof.gamma[0], proof.gamma[1]],
    c: proof.c,
    s: proof.s,
    seed: proof.seed,
    uWitness: addr,
    cGammaWitness: [proof.cGammaWitness[0], proof.cGammaWitness[1]],
    sHashWitness: [proof.sHashWitness[0], proof.sHashWitness[1]],
    zInv: proof.zInv,
  };
}

async function main() {
  const head = await publicClient.getBlockNumber();
  const fromBlock = head > SCAN_BLOCKS ? head - SCAN_BLOCKS : 0n;
  const logs = await publicClient.getLogs({
    address: COORDINATOR_ADDRESS,
    event: abi.find((e) => e.name === "RandomnessRequested"),
    fromBlock,
    toBlock: head,
  });
  console.log(`${logs.length} request(s) in the last ${head - fromBlock} blocks`);

  let failures = 0;
  for (const log of logs) {
    const requestId = log.args.requestId;
    const [, , fulfilled, seed] = await publicClient.readContract({
      ...coordinator,
      functionName: "pendingRequest",
      args: [requestId],
    });
    if (fulfilled) continue;

    console.log(`proving request ${requestId} (seed ${seed})…`);
    try {
      const proof = prove(BigInt(VRF_SECRET_KEY), seed);
      void encodeProof; // (exported for ffi tests; tuple form used here)
      const { request } = await publicClient.simulateContract({
        ...coordinator,
        functionName: "fulfill",
        args: [proofToTuple(proof), requestId],
        account,
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });
      console.log(`fulfill(${requestId}): ${receipt.status} @ ${receipt.blockNumber}`);
      if (receipt.status !== "success") failures++;
    } catch (err) {
      // a competitor may have fulfilled first — recheck before counting it
      const [, , nowFulfilled] = await publicClient.readContract({
        ...coordinator,
        functionName: "pendingRequest",
        args: [requestId],
      });
      if (nowFulfilled) {
        console.log(`request ${requestId} already fulfilled`);
        continue;
      }
      console.error(`fulfill(${requestId}) failed:`, err.shortMessage ?? err.message);
      failures++;
    }
  }
  if (failures > 0) process.exit(1);
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

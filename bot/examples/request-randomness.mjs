// Request a verifiable random number from DogeOS VRF and wait for it.
//
//   PRIVATE_KEY=0x... COORDINATOR=0x... node examples/request-randomness.mjs
//
// Shown verbatim in the developer docs (/docs#quickstart-js).
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const dogeos = defineChain({
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: { name: "Dogecoin", symbol: "DOGE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.dogeos.com/"] } },
});

const coordinator = {
  address: process.env.COORDINATOR,
  abi: parseAbi([
    "function requestFee() view returns (uint256)",
    "function requestRandomness(bytes32 userSeed) payable returns (uint256 requestId)",
    "function pendingRequest(uint256 requestId) view returns (address consumer, uint64 requestedAt, bool fulfilled, uint256 seed)",
    "function responses(uint256 requestId) view returns (uint256)",
    "event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint256 seed)",
  ]),
};

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const pub = createPublicClient({ chain: dogeos, transport: http() });
const wallet = createWalletClient({ account, chain: dogeos, transport: http() });

// 1. Pay the current fee and request randomness
const fee = await pub.readContract({ ...coordinator, functionName: "requestFee" });
const hash = await wallet.writeContract({
  ...coordinator,
  functionName: "requestRandomness",
  args: [keccak256(toHex(`my-app:${Date.now()}`))],
  value: fee,
});
const receipt = await pub.waitForTransactionReceipt({ hash });
const [requested] = parseEventLogs({
  abi: coordinator.abi,
  logs: receipt.logs,
  eventName: "RandomnessRequested",
});
const { requestId } = requested.args;
console.log(`request ${requestId} sent (${hash})`);

// 2. Wait for the oracle's proof to be verified on-chain
for (;;) {
  const [, , fulfilled] = await pub.readContract({
    ...coordinator,
    functionName: "pendingRequest",
    args: [requestId],
  });
  if (fulfilled) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const randomness = await pub.readContract({
  ...coordinator,
  functionName: "responses",
  args: [requestId],
});
console.log(`random number: ${randomness}`);
console.log(`dice roll (1-6): ${(randomness % 6n) + 1n}`);

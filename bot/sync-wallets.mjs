// Applies the repo-configured payout addresses to the contract.
//
// The protocol treasury and Dogecoin Foundation wallet are stored ON-CHAIN
// (that's what actually pays out). This job makes the GitHub repo variables
// TREASURY_ADDRESS / FOUNDATION_ADDRESS the operator-facing source of truth:
// it reads both, compares with the contract, and sends setTreasury /
// setFoundationWallet for any that differ. It signs with the wallet-admin
// key, a narrow on-chain role that can change ONLY these two addresses.
//
// Env:
//   RAFFLE_ADDRESS, WALLET_ADMIN_PRIVATE_KEY (the bot key), RPC_URL (optional)
//   TREASURY_ADDRESS, FOUNDATION_ADDRESS — either may be empty to leave as-is

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.RPC_URL ?? "https://rpc.testnet.dogeos.com/";
const { RAFFLE_ADDRESS, WALLET_ADMIN_PRIVATE_KEY } = process.env;
if (!RAFFLE_ADDRESS || !WALLET_ADMIN_PRIVATE_KEY) {
  console.error("RAFFLE_ADDRESS and WALLET_ADMIN_PRIVATE_KEY are required");
  process.exit(1);
}

const chain = defineChain({
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: { name: "Dogecoin", symbol: "DOGE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const abi = parseAbi([
  "function treasury() view returns (address)",
  "function foundationWallet() view returns (address)",
  "function walletAdmin() view returns (address)",
  "function owner() view returns (address)",
  "function setTreasury(address)",
  "function setFoundationWallet(address)",
]);
const account = privateKeyToAccount(WALLET_ADMIN_PRIVATE_KEY);
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
const raffle = { address: RAFFLE_ADDRESS, abi };

const targets = [
  { name: "treasury", env: "TREASURY_ADDRESS", read: "treasury", write: "setTreasury" },
  { name: "foundation", env: "FOUNDATION_ADDRESS", read: "foundationWallet", write: "setFoundationWallet" },
];

async function main() {
  const [admin, owner] = await Promise.all([
    pub.readContract({ ...raffle, functionName: "walletAdmin" }),
    pub.readContract({ ...raffle, functionName: "owner" }),
  ]);
  if (![admin, owner].map((a) => a.toLowerCase()).includes(account.address.toLowerCase())) {
    console.error(`signer ${account.address} is neither walletAdmin (${admin}) nor owner (${owner})`);
    process.exit(1);
  }

  let changed = 0;
  for (const t of targets) {
    const want = (process.env[t.env] ?? "").trim();
    if (!want) {
      console.log(`${t.name}: ${t.env} not set — leaving on-chain value`);
      continue;
    }
    if (!isAddress(want)) {
      console.error(`${t.name}: ${t.env}="${want}" is not a valid address`);
      process.exit(1);
    }
    const current = await pub.readContract({ ...raffle, functionName: t.read });
    if (getAddress(current) === getAddress(want)) {
      console.log(`${t.name}: already ${current}`);
      continue;
    }
    console.log(`${t.name}: ${current} -> ${getAddress(want)}`);
    const { request } = await pub.simulateContract({
      ...raffle,
      functionName: t.write,
      args: [getAddress(want)],
      account,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    console.log(`  ${t.write}: ${receipt.status} (${hash})`);
    if (receipt.status !== "success") process.exit(1);
    changed++;
  }
  console.log(changed ? `${changed} address(es) updated` : "nothing to change");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

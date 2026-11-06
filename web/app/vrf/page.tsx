"use client";

import Link from "next/link";
import { formatEther, parseAbi } from "viem";
import { useReadContracts } from "wagmi";
import { VRF_COORDINATOR_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { CodeBlock } from "../code-block";
import { CoinRain, DogeCoin, Rays, WowSeal } from "../doge";
import { SectionHeading } from "../sections";
import { SiteFooter, SiteNav } from "../site-chrome";

const coordinatorAbi = parseAbi([
  "function requestFee() view returns (uint256)",
  "function lastRequestId() view returns (uint256)",
  "function callbackGasLimit() view returns (uint32)",
]);
const coordinator = { address: VRF_COORDINATOR_ADDRESS, abi: coordinatorAbi } as const;
const explorer = dogeosChikyu.blockExplorers.default.url;

const TEASER = `function roll() external payable returns (uint256 requestId) {
    requestId = coordinator.requestRandomness{value: msg.value}(
        keccak256(abi.encode(msg.sender, block.number))
    );
}

// called back once the proof is verified on-chain
function rawFulfillRandomness(uint256 requestId, uint256 randomness) external {
    require(msg.sender == address(coordinator));
    uint256 dice = (randomness % 6) + 1;
}`;

const FEATURES = [
  {
    title: "Unforgeable",
    body: "Every random number ships with an ECVRF proof tied to our public key. A number we didn't honestly derive simply fails verification — not even we can pick the outcome.",
  },
  {
    title: "Verified on-chain",
    body: "The coordinator contract checks each proof before your contract ever sees the number. You don't have to trust the oracle, the sequencer, or us.",
  },
  {
    title: "Pay in DOGE",
    body: "A flat fee per request in native DOGE, gas for delivery included. No tokens to buy, no subscriptions, no accounts.",
  },
  {
    title: "Battle-tested math",
    body: "Proof verification uses Chainlink's open-source (MIT) secp256k1 VRF verifier, unmodified — the same cryptography securing randomness across EVM chains.",
  },
];

const FLOW = [
  { n: 1, title: "Your contract requests", body: "Call requestRandomness(seed) with the fee. You get a request id." },
  { n: 2, title: "Oracle proves", body: "Our oracle derives the random number from your request with its secret key and builds a proof." },
  { n: 3, title: "Contract verifies", body: "The coordinator checks the proof on-chain. Invalid proofs are rejected." },
  { n: 4, title: "You get called back", body: "rawFulfillRandomness(id, randomness) lands in your contract. Done." },
];

const USE_CASES = ["Raffles & lotteries", "Game loot & crits", "NFT trait reveals", "Fair matchmaking", "Random airdrops", "Card shuffles"];

export default function VrfPage() {
  const { data } = useReadContracts({
    contracts: [
      { ...coordinator, functionName: "requestFee" },
      { ...coordinator, functionName: "lastRequestId" },
      { ...coordinator, functionName: "callbackGasLimit" },
    ],
    query: { refetchInterval: 20_000 },
  });
  const fee = data?.[0]?.result as bigint | undefined;
  const served = data?.[1]?.result as bigint | undefined;
  const gasLimit = data?.[2]?.result as number | undefined;

  const stats = [
    { label: "Price per request", value: fee !== undefined ? `${formatEther(fee)} DOGE` : "…" },
    { label: "Requests served", value: served !== undefined ? served.toLocaleString() : "…" },
    { label: "Callback gas", value: gasLimit !== undefined ? gasLimit.toLocaleString() : "…" },
    { label: "Network", value: "DogeOS testnet" },
  ];

  return (
    <div className="relative overflow-x-hidden">
      <SiteNav />

      {/* HERO */}
      <header className="relative overflow-hidden bg-gradient-to-b from-[#2a1d06] via-[#3b2a0b] to-[#4a3510] text-amber-50">
        <CoinRain count={12} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 pt-12 md:grid-cols-[1.15fr_1fr] md:pt-20">
          <div className="relative z-10">
            <div className="display mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 text-sm font-bold text-amber-300">
              <DogeCoin size={18} /> The first VRF on DogeOS
            </div>
            <h1 className="display text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl">
              Randomness
              <br />
              <span className="gold-text gold-shadow">you can prove.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-amber-100/80">
              DogeOS VRF gives any smart contract on DogeOS a verifiable random number — with a
              cryptographic proof that&apos;s checked on-chain before you ever see it. Built for
              games, raffles and anything that needs to be fair.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/docs"
                className="doge-btn pulse-glow display rounded-full bg-amber-400 px-8 py-4 text-lg font-bold text-amber-950 shadow-lg hover:bg-amber-300"
              >
                Read the docs
              </Link>
              <a
                href={`${explorer}/address/${VRF_COORDINATOR_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
                className="doge-btn display rounded-full border-2 border-amber-300 px-8 py-4 text-lg font-bold text-amber-200"
              >
                View contract
              </a>
            </div>
          </div>
          <div className="relative mx-auto flex aspect-square w-full max-w-[420px] items-center justify-center">
            <Rays size={560} />
            <div className="absolute inset-[14%] rounded-full bg-amber-400/30 blur-3xl" />
            <div className="float relative">
              <DogeCoin size={300} className="drop-shadow-[0_25px_35px_rgba(0,0,0,0.5)]" />
            </div>
            <div className="absolute -bottom-2 left-0 -rotate-12 sm:left-4">
              <WowSeal size={110} className="bob drop-shadow-xl" />
            </div>
            <div className="absolute right-0 top-6 rotate-6 rounded-2xl bg-black/50 px-3 py-2 font-mono text-xs text-amber-300 shadow-xl backdrop-blur sm:right-2">
              verifyProof(γ, c, s) ✓
            </div>
          </div>
        </div>
      </header>

      {/* STATS */}
      <div className="border-y-4 border-amber-400 bg-amber-950">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-amber-100/10 px-4 py-6 md:grid-cols-4 md:divide-x">
          {stats.map((s) => (
            <div key={s.label} className="px-4 py-2 text-center">
              <div className="display gold-text text-3xl font-bold">{s.value}</div>
              <div className="text-xs font-semibold uppercase tracking-widest text-amber-200/60">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4">
        {/* FEATURES */}
        <section className="pt-20">
          <SectionHeading kicker="Why DogeOS VRF" title="Fair by construction">
            Block hashes can be influenced and timed. A VRF can&apos;t — every number comes with
            proof that it was derived honestly.
          </SectionHeading>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-3xl border-2 border-amber-200 bg-white p-6 shadow-lg shadow-amber-100">
                <DogeCoin size={44} className="mb-3 drop-shadow" />
                <h3 className="display text-xl font-bold text-amber-950">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-amber-900/75">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FLOW */}
        <section className="pt-24">
          <SectionHeading kicker="How it works" title="Request, prove, verify, done" />
          <div className="grid gap-4 md:grid-cols-4">
            {FLOW.map((s, i) => (
              <div key={s.n} className="relative">
                <div className="h-full rounded-3xl bg-amber-950 p-6 text-amber-50 shadow-xl">
                  <div className="display mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-lg font-bold text-amber-950">
                    {s.n}
                  </div>
                  <h3 className="display text-lg font-bold text-amber-200">{s.title}</h3>
                  <p className="mt-2 text-sm text-amber-100/75">{s.body}</p>
                </div>
                {i < FLOW.length - 1 && (
                  <div className="display absolute -right-4 top-1/2 z-10 hidden -translate-y-1/2 text-3xl font-bold text-amber-500 md:block">
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* CODE TEASER */}
        <section className="grid items-center gap-10 pt-24 md:grid-cols-2">
          <div>
            <div className="display mb-2 text-sm font-bold uppercase tracking-[0.2em] text-amber-600">
              Integrate in minutes
            </div>
            <h2 className="display text-4xl font-bold text-amber-950">Two functions. That&apos;s the integration.</h2>
            <p className="mt-4 text-lg text-amber-900/75">
              Request with one call, receive the number in a callback. The docs walk through a
              complete, tested dice-roller contract and a JavaScript client you can run today.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {USE_CASES.map((u) => (
                <span key={u} className="rounded-full border-2 border-amber-200 bg-white px-3 py-1 text-sm font-semibold text-amber-800">
                  {u}
                </span>
              ))}
            </div>
            <Link href="/docs#quickstart-solidity" className="doge-btn display mt-8 inline-block rounded-full bg-amber-500 px-6 py-3 font-bold text-white">
              Quickstart →
            </Link>
          </div>
          <CodeBlock code={TEASER} lang="solidity" title="YourGame.sol (simplified)" />
        </section>

        {/* PROOF POINT */}
        <section className="pb-24 pt-24">
          <div className="gold-card flex flex-col items-center gap-6 rounded-[2rem] border-2 border-amber-300 p-8 text-center shadow-xl sm:flex-row sm:text-left">
            <DogeCoin size={110} className="float shrink-0 drop-shadow-xl" />
            <div className="flex-1">
              <h3 className="display text-3xl font-bold text-amber-950">Already powering Doge Raffle</h3>
              <p className="mt-2 text-amber-900/80">
                Every monthly jackpot draw on Doge Raffle is decided by DogeOS VRF, with the winning
                ticket recorded on-chain for anyone to check.
              </p>
            </div>
            <Link href="/" className="doge-btn display shrink-0 rounded-full bg-amber-950 px-6 py-3 font-bold text-amber-300">
              See the raffle
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

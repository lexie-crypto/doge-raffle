import type { Metadata } from "next";
import { VRF_COORDINATOR_ADDRESS, dogeosChikyu } from "@/lib/chain";
import { CodeBlock } from "../code-block";
import { DogeCoin } from "../doge";
import { SiteFooter, SiteNav } from "../site-chrome";
import { jsExample, solidityExample } from "./snippets";

export const metadata: Metadata = {
  title: "DogeOS VRF docs — Doge Raffle",
  description: "Add verifiable on-chain randomness to your DogeOS smart contract.",
};

const explorer = dogeosChikyu.blockExplorers.default.url;
const COORD = VRF_COORDINATOR_ADDRESS;

const TOC = [
  ["overview", "Overview"],
  ["network", "Network & addresses"],
  ["quickstart-solidity", "Quickstart: Solidity"],
  ["quickstart-js", "Quickstart: JavaScript"],
  ["lifecycle", "Request lifecycle"],
  ["fees", "Fees"],
  ["reference", "Contract reference"],
  ["security", "Security & best practices"],
  ["verify", "Verifying a result"],
  ["status", "Testnet status"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="display mb-4 mt-14 scroll-mt-24 text-3xl font-bold text-amber-950 first:mt-0">
      <a href={`#${id}`} className="hover:text-amber-600">
        {children}
      </a>
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 leading-relaxed text-amber-950/80">{children}</p>;
}

function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[0.85em] text-amber-900">{children}</code>
  );
}

function Callout({ kind = "note", children }: { kind?: "note" | "warn"; children: React.ReactNode }) {
  const style =
    kind === "warn"
      ? "border-orange-300 bg-orange-50 text-orange-950"
      : "border-amber-300 bg-amber-50 text-amber-950";
  return <div className={`my-5 rounded-2xl border-2 p-4 text-sm leading-relaxed ${style}`}>{children}</div>;
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-2xl border-2 border-amber-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-amber-50">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-3 font-bold text-amber-950">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-amber-100 align-top">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 text-amber-950/80">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="relative overflow-x-hidden">
      <SiteNav />

      <header className="border-b-4 border-amber-400 bg-amber-950 text-amber-50">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-10">
          <DogeCoin size={72} className="bob shrink-0" />
          <div>
            <div className="display text-sm font-bold uppercase tracking-[0.2em] text-amber-300">Developer docs</div>
            <h1 className="display text-4xl font-bold sm:text-5xl">DogeOS VRF</h1>
            <p className="mt-1 text-amber-100/75">Verifiable on-chain randomness for your DogeOS contracts.</p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1 text-sm">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-600">On this page</div>
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-1.5 font-semibold text-amber-900/75 hover:bg-amber-100 hover:text-amber-950">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl">
          <H2 id="overview">Overview</H2>
          <P>
            DogeOS VRF (verifiable random function) gives smart contracts on DogeOS random numbers
            that nobody can predict or manipulate — including us. Your contract requests
            randomness and pays a small fee in DOGE. Our oracle derives the random number from your
            request with its secret key and produces a cryptographic proof. The coordinator
            contract verifies that proof on-chain against the oracle&apos;s registered public key,
            and only then calls your contract back with the number.
          </P>
          <P>
            Because every output must pass on-chain verification, the oracle cannot substitute a
            number it likes better, and the DogeOS sequencer can&apos;t influence it the way it could
            influence a block hash. Proof verification uses Chainlink&apos;s MIT-licensed secp256k1
            ECVRF verifier, unmodified.
          </P>

          <H2 id="network">Network & addresses</H2>
          <Table
            head={["", "Value"]}
            rows={[
              ["Network", "DogeOS Chikyū testnet"],
              ["Chain id", <C key="c">{dogeosChikyu.id}</C>],
              ["RPC", <C key="r">{dogeosChikyu.rpcUrls.default.http[0]}</C>],
              ["Explorer", <a key="e" className="text-amber-700 underline" href={explorer}>{explorer.replace("https://", "")}</a>],
              [
                "VRF coordinator",
                <a key="a" className="break-all font-mono text-amber-700 underline" href={`${explorer}/address/${COORD}`}>
                  {COORD}
                </a>,
              ],
              ["Gas token", "DOGE (native, 18 decimals)"],
            ]}
          />

          <H2 id="quickstart-solidity">Quickstart: Solidity</H2>
          <P>
            A complete consumer contract: players pay the VRF fee to roll a die, and the result is
            written when the coordinator calls back. This exact file is in the repo at{" "}
            <C>contracts/src/examples/DiceRoller.sol</C> and is covered by an end-to-end test that
            verifies real proofs.
          </P>
          <CodeBlock code={solidityExample} lang="solidity" title="DiceRoller.sol" />
          <ol className="my-5 list-decimal space-y-2 pl-6 text-amber-950/80">
            <li>
              Deploy it with the coordinator address:{" "}
              <C>new DiceRoller({COORD.slice(0, 10)}…)</C>.
            </li>
            <li>
              Read the current fee with <C>requestFee()</C> on the coordinator, then call{" "}
              <C>roll()</C> sending exactly that amount.
            </li>
            <li>
              Listen for <C>Rolled</C> — or read <C>lastRoll(player)</C> — once the request is
              fulfilled.
            </li>
          </ol>

          <H2 id="quickstart-js">Quickstart: JavaScript</H2>
          <P>
            You can also request randomness straight from a wallet or backend (no contract needed):
            the result is stored on the coordinator for you to read. This script was run end-to-end
            against the testnet; it&apos;s in the repo at <C>bot/examples/request-randomness.mjs</C>.
          </P>
          <CodeBlock code={jsExample} lang="javascript" title="request-randomness.mjs (viem)" />

          <H2 id="lifecycle">Request lifecycle</H2>
          <ol className="my-5 list-decimal space-y-3 pl-6 text-amber-950/80">
            <li>
              <b>Request.</b> You call <C>requestRandomness(userSeed)</C> with the fee. The
              coordinator assigns a request id and derives the VRF seed as{" "}
              <C>keccak256(abi.encode(chainId, coordinator, requestId, msg.sender, userSeed))</C>{" "}
              — unique per request, so two requests can never share an output — and emits{" "}
              <C>RandomnessRequested(requestId, consumer, seed)</C>.
            </li>
            <li>
              <b>Prove.</b> The oracle computes the VRF output and proof for that seed with its
              secret key.
            </li>
            <li>
              <b>Verify.</b> Anyone may submit the proof with <C>fulfill(proof, requestId)</C> — it
              is self-authenticating. The coordinator checks it against the registered key and seed,
              stores the output in <C>responses(requestId)</C>, and emits{" "}
              <C>RandomnessFulfilled(requestId, randomness, callbackSuccess)</C>.
            </li>
            <li>
              <b>Callback.</b> The coordinator calls{" "}
              <C>rawFulfillRandomness(requestId, randomness)</C> on the requester with a gas limit
              of <C>callbackGasLimit()</C> (500,000 by default). If your callback reverts or runs out
              of gas, the number is still stored and you can read it from <C>responses</C>.
            </li>
          </ol>

          <H2 id="fees">Fees</H2>
          <P>
            Each request costs a flat fee in native DOGE — currently <b>2 DOGE</b> — sent as{" "}
            <C>msg.value</C>. The amount must match exactly; read the live value from{" "}
            <C>requestFee()</C> rather than hard-coding it, since it can be adjusted. The fee covers
            the oracle&apos;s gas for delivering your result; there&apos;s nothing else to pay and no
            subscription or token.
          </P>

          <H2 id="reference">Contract reference</H2>
          <h3 className="display mb-2 mt-6 text-xl font-bold text-amber-950">Functions</h3>
          <Table
            head={["Function", "Description"]}
            rows={[
              [<C key="1">requestRandomness(bytes32 userSeed) payable → uint256 requestId</C>, "Request a random number. Send exactly requestFee()."],
              [<C key="2">requestFee() → uint256</C>, "Current fee per request, in wei of DOGE."],
              [<C key="3">pendingRequest(uint256 id) → (consumer, requestedAt, fulfilled, seed)</C>, "Status of a request."],
              [<C key="4">responses(uint256 id) → uint256</C>, "The verified random number, once fulfilled (0 before)."],
              [<C key="5">lastRequestId() → uint256</C>, "Total requests made."],
              [<C key="6">callbackGasLimit() → uint32</C>, "Gas forwarded to your callback."],
              [<C key="7">oraclePublicKey(uint256) → uint256</C>, "The registered oracle key (x at index 0, y at index 1)."],
              [<C key="8">fulfill(Proof proof, uint256 id)</C>, "Submit a proof. Called by the oracle; permissionless."],
            ]}
          />
          <h3 className="display mb-2 mt-6 text-xl font-bold text-amber-950">Your callback</h3>
          <Table
            head={["Function", "Notes"]}
            rows={[
              [<C key="1">rawFulfillRandomness(uint256 requestId, uint256 randomness)</C>, "Implement this. Must check msg.sender is the coordinator."],
            ]}
          />
          <h3 className="display mb-2 mt-6 text-xl font-bold text-amber-950">Events & errors</h3>
          <Table
            head={["Name", "When"]}
            rows={[
              [<C key="1">RandomnessRequested(id, consumer, seed)</C>, "A request was made."],
              [<C key="2">RandomnessFulfilled(id, randomness, callbackSuccess)</C>, "A proof was verified and delivered."],
              [<C key="3">WrongFee(expected, sent)</C>, "msg.value didn't match requestFee()."],
              [<C key="4">UnknownRequest / AlreadyFulfilled</C>, "Fulfilling a request that doesn't exist or is done."],
              [<C key="5">WrongKey / WrongSeed</C>, "Proof made with another key or for another request."],
            ]}
          />

          <H2 id="security">Security & best practices</H2>
          <ul className="my-5 list-disc space-y-3 pl-6 text-amber-950/80">
            <li>
              <b>Always check the caller.</b> In <C>rawFulfillRandomness</C>, require{" "}
              <C>msg.sender == coordinator</C>. Otherwise anyone can feed you a number.
            </li>
            <li>
              <b>Lock the inputs before you request.</b> Close the bet, entry list or game state
              first, then request. Never let users act after seeing a result that affects them.
            </li>
            <li>
              <b>One request per outcome.</b> Don&apos;t reuse a random number for several
              independent decisions without deriving separate values, e.g.{" "}
              <C>keccak256(abi.encode(randomness, i))</C>.
            </li>
            <li>
              <b>Keep the callback small.</b> Stay well under the 500,000 gas limit and don&apos;t
              revert on valid input. If you need heavy work, store the number and process it in a
              separate transaction.
            </li>
            <li>
              <b>Plan for a slow response.</b> The oracle can&apos;t forge an output, but like any
              oracle it could fail to respond. For anything with money at stake, add your own
              timeout fallback, as Doge Raffle does.
            </li>
            <li>
              <b>Mind reorgs.</b> DogeOS can reorg up to 17 blocks. For high-value outcomes, wait for
              that depth before treating a result as final off-chain.
            </li>
          </ul>

          <H2 id="verify">Verifying a result</H2>
          <P>
            A result only exists if its <C>fulfill</C> transaction succeeded — and it only succeeds
            if the proof passed on-chain verification against the oracle&apos;s registered key and
            your request&apos;s seed. To re-check independently, take the proof from that
            transaction&apos;s input data and run it through the same verifier (
            <C>contracts/src/vrf/vendor/VRF.sol</C>), for example in a Foundry test. The random
            number is <C>uint256(keccak256(abi.encode(3, gamma)))</C>, where <C>gamma</C> is part of
            the proof.
          </P>

          <H2 id="status">Testnet status</H2>
          <Callout kind="warn">
            DogeOS VRF is running on the DogeOS Chikyū <b>testnet</b> while DogeOS mainnet is
            pending. Use test DOGE from the{" "}
            <a className="underline" href="https://faucet.testnet.dogeos.com">DogeOS faucet</a>.
            Response times are not yet covered by an SLA during the beta.
          </Callout>
          <P>
            Questions or want to integrate? Open an issue on{" "}
            <a className="font-semibold text-amber-700 underline" href="https://github.com/lexie-crypto/doge-raffle/issues">
              GitHub
            </a>
            .
          </P>
        </article>
      </div>

      <SiteFooter />
    </div>
  );
}

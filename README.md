# Doge Raffle 🐕

A recurring native-DOGE raffle dApp for **DogeOS** (the EVM ZK-rollup app layer for Dogecoin). Users connect a wallet and buy tickets with DOGE; on the 1st of every month (00:00 UTC) a winner is drawn, weighted by tickets held. **Winners claim their own prize before a fixed deadline; unclaimed prizes roll into the next jackpot.**

> **Live on Chikyū testnet:**
> - DogeRaffle: [`0x0B0024090b1a2BD99128654E0047BB27fE30D05C`](https://dogeos-testnet.l2scan.co/address/0x0B0024090b1a2BD99128654E0047BB27fE30D05C)
> - DogeVRFCoordinator: [`0x4463AF4EAccFFB4AC14e87e9dac09B59e9E3614c`](https://dogeos-testnet.l2scan.co/address/0x4463AF4EAccFFB4AC14e87e9dac09B59e9E3614c)

> **Status: DogeOS Chikyū testnet only.** DogeOS mainnet has not launched; when it does, deployment is a config change (new RPC/chain id). **Real-value launch is additionally blocked on the randomness trust model below.**

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry project: `DogeRaffle.sol`, tests, deploy script |
| `web/` | Next.js frontend (wagmi + viem, browser wallets only: every extension and every mobile wallet's in-app browser via EIP-1193/EIP-6963 — no WalletConnect, no project id). Wallet = account: a "My tickets" dashboard shows ticket numbers, past rounds, each draw's winning ticket and your result, read directly from the contract via Multicall3. |
| `bot/` | Draw-keeper cron bot + GitHub Actions workflow |

## How it works

1. **Buy tickets** — `buyTickets(bundleId)` with the exact DOGE value. Default bundles (owner-configurable via `setBundles`): 1 ticket = 20 DOGE, 5 = 90, 10 = 170. Tickets are numbered 0…N−1 per round and stored as cumulative ranges, so a 10,000-ticket purchase costs the same gas/storage as 1. Every purchase emits `TicketsPurchased(round, buyer, bundle, firstTicket, tickets, paid)`, and `entryAt(round, i)` exposes each purchase's buyer and ticket range, so anyone can audit who held which numbers.
2. **Draw on the 1st of every month, permissionless** — DogeOS has no keeper network, so instead of a privileged cron, *anyone* can trigger the draw once the round ends and earn a 1 DOGE bounty (paid from the fee, never from the prize):
   - `commitDraw()` settles the prior round's expired prize into the jackpot (exactly once), closes sales, and pins a block ~10 blocks ahead; a late draw self-heals — the next round still ends on the following 1st;
   - `finalizeDraw()` derives the winning ticket number (randomness mod total tickets; stored in `winningTicketOf(round)` and emitted in `WinnerDrawn`), **escrows** the prize as a claim, pays the treasury (protocol fee − bounty), the Dogecoin Foundation wallet (foundation fee) and the caller (bounty), then opens the next round.
   - The `bot/` workflow is a backstop that calls these if nobody else does. Because draws are calendar-fixed (1st of the month, 00:00 UTC), it runs exactly twice a month: once at the draw and a backup six hours later that exits in seconds if the draw already happened. GitHub cron is best-effort; eventual execution is guaranteed only while a funded bot or any independent caller submits transactions.
3. **Winner claims, and pays gas** — the prize is never pushed. `claimPrize(roundId)` is winner-only, one-time, and valid **strictly before the claim cutoff**: the next round's scheduled end time, fixed the moment that round opens. The schedule is fixed in code (next calendar-month boundary), so nothing can move an existing cutoff. A claim whose transfer fails reverts — the claim is never burned.
4. **Unclaimed prizes roll** — at the next round's commit, an expired prize is extinguished and added to that round's gross pot, exactly once. Previously claimed amounts never roll. If a round has no tickets, no winner is drawn, no fee is charged, and the carried jackpot survives (through any number of empty rounds) until a ticketed draw happens.
5. **Fees — 5% protocol, 5% Dogecoin Foundation, 90% winner** — each round snapshots both `feeBps` (protocol treasury) and `foundationBps` (Dogecoin Foundation wallet, set via `setFoundationWallet`) when it opens, so the owner cannot re-fee an active pot. Each is hard-capped at 10%. Both apply to the **full gross pot — new ticket revenue plus rollover** (rolled funds are deliberately charged again); the finalizer bounty comes out of the protocol fee only. Exact example:

   | | Round 1 | Round 2 (R1 unclaimed) |
   |---|---|---|
   | New ticket revenue | 1,000.00 DOGE | 1,000.00 DOGE |
   | Expired prize added | 0.00 | 900.00 |
   | **Draw pot** | **1,000.00** | **1,900.00** |
   | 5% protocol fee | 50.00 | 95.00 |
   | 5% Dogecoin Foundation | 50.00 | 95.00 |
   | 1 DOGE finalizer bounty | from protocol fee | from protocol fee |
   | Treasury net receipt | 49.00 | 94.00 |
   | **Winner claimable (90%)** | **900.00** | **1,710.00** |

6. **Fail-closed** — `pause()` stops ticket **sales only**; draws, claims and withdrawals can never be paused. Failed treasury/bounty pushes credit a pull-based `withdrawable` balance. The owner can never sweep the pot, an awarded claim, or anyone's balance. Value conservation (every wei of tickets = claims + rollover + fee + bounty) is enforced by tests at wei precision.

### Randomness: self-operated VRF with blockhash fallback

Chainlink VRF does not support DogeOS, so this repo ships its own VRF service — the first randomness infrastructure on the chain:

- **`contracts/src/vrf/DogeVRFCoordinator.sol`** — Chainlink-style request/fulfill coordinator. Proofs are verified **on-chain** against the registered oracle public key using Chainlink's MIT-licensed secp256k1 ECVRF verifier (vendored unmodified at `contracts/src/vrf/vendor/VRF.sol`, from `smartcontractkit/chainlink` tag `contracts-v1.3.0`). Neither the oracle nor the sequencer can forge or bias an output; anyone can re-verify every fulfillment.
- **`bot/ecvrf.mjs`** — the off-chain prover (mirrors the verifier byte-for-byte; proven compatible by Foundry ffi tests that verify JS-generated proofs on-chain). **`bot/vrf-oracle.mjs`** scans for requests and fulfills them on the draw-bot cron.
- **Raffle integration** — `commitDraw()` requests randomness (the raffle is fee-exempt); the coordinator's verified callback settles the draw. If the oracle stays silent past `vrfTimeout` (default 6h), the permissionless **blockhash fallback** settles instead — so a withholding oracle can delay a draw but never abort or redirect it, and the delay is publicly visible on-chain. With no coordinator set the blockhash path runs alone (bootstrap mode; `PREVRANDAO` returns 0 on DogeOS, hence commit + future-blockhash).
- **Monetization** — the coordinator charges a per-request fee in native DOGE (default 2 DOGE, owner-settable) to any third-party DogeOS dApp that wants verifiable randomness; fees accrue to the owner. House consumers are whitelisted fee-exempt.

**Residual trust, stated plainly:** VRF outputs are unforgeable, but the key holder sees an output before posting and could *withhold* it, steering the round to the (also unpredictable) blockhash fallback; the fallback itself carries sequencer-influence and timing caveats. This is a major upgrade over blockhash-only, but **real-value launch still requires a reviewed randomness design** (e.g. key management, fallback policy) **and legal clearance.** Keep the VRF secret key offline-backed and separate from the gas wallet.

## Development

```bash
# contracts (requires Foundry: https://getfoundry.sh)
cd contracts
forge test          # 37 tests: claims, rollover, boundary races, exact fee
                    # arithmetic, fuzz conservation, fairness, reentrancy

# frontend
cd web
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_RAFFLE_ADDRESS
npm run dev
```

## Deploy to Chikyū testnet

> Solidity bytecode changes require deploying a **new** contract — an already
> deployed immutable contract cannot be patched. Before migrating off a prior
> deployment, check it for current deposits/claims and let them settle.

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...   # fund it at https://faucet.testnet.dogeos.com
export RAFFLE_TREASURY=0x...        # receives the 5% protocol fee (defaults to deployer)
export RAFFLE_FOUNDATION=0x...      # Dogecoin Foundation wallet, receives 5% (defaults to deployer — set it, or call setFoundationWallet later)
forge script script/Deploy.s.sol --rpc-url dogeos_testnet --broadcast
```

Chain: id `6281971`, RPC `https://rpc.testnet.dogeos.com/`, explorer [dogeos-testnet.l2scan.co](https://dogeos-testnet.l2scan.co). Contracts compile with Solidity 0.8.31 / `osaka` EVM target per the [DogeOS docs](https://docs.dogeos.com/en/developers/ethereum-and-dogeos-differences).

Then set the repo's Actions config (Settings → Secrets and variables → Actions):

| Kind | Name | What |
|---|---|---|
| Variable | `RAFFLE_ADDRESS` | deployed DogeRaffle |
| Variable | `COORDINATOR_ADDRESS` | deployed DogeVRFCoordinator |
| Variable | `TREASURY_ADDRESS` | protocol fee recipient — change anytime |
| Variable | `FOUNDATION_ADDRESS` | Dogecoin Foundation fee recipient — change anytime |
| Secret | `BOT_PRIVATE_KEY` | hot wallet: pays draw gas, fulfills VRF, and holds the on-chain `walletAdmin` role |
| Secret | `VRF_SECRET_KEY` | ECVRF oracle key (keep an offline copy; rotate with `setOracleKey`) |

**Payout addresses are configurable anytime.** The contract stores `treasury` and `foundationWallet`; the `sync-wallets` workflow (run it manually after editing the two variables — it also runs before every draw) reads `TREASURY_ADDRESS` / `FOUNDATION_ADDRESS`, compares with the chain, and applies any change. It signs with the bot key, which holds the `walletAdmin` role: a deliberately narrow permission that can change **only** these two addresses — not fees, pots, claims, pausing or VRF wiring. The owner can also change them directly from the explorer and can revoke the role with `setWalletAdmin(0x0)`.

## Credits

The Dogecoin logo (`web/public/dogecoin-logo*.png`, `web/app/icon.png`) is taken from the Dogecoin Core repository ([dogecoin/dogecoin](https://github.com/dogecoin/dogecoin), `src/qt/res/icons/dogecoin.png`, MIT license) and used to denote the DOGE currency. Dogecoin is a trademark of its respective owners; this project is not affiliated with or endorsed by the Dogecoin Foundation.

## Legal

A paid-entry raffle is regulated gambling/lottery activity in most jurisdictions. This repository is a testnet technology demonstration; obtain legal advice before operating it for real value.

# Doge Raffle 🐕

A recurring native-DOGE raffle dApp for **DogeOS** (the EVM ZK-rollup app layer for Dogecoin). Users connect a wallet and buy tickets with DOGE; every 30 days a winner is drawn, weighted by tickets held. **Winners claim their own prize before a fixed deadline; unclaimed prizes roll into the next jackpot.**

> **Status: DogeOS Chikyū testnet only.** DogeOS mainnet has not launched; when it does, deployment is a config change (new RPC/chain id). **Real-value launch is additionally blocked on the randomness trust model below.**

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry project: `DogeRaffle.sol`, tests, deploy script |
| `web/` | Next.js frontend (wagmi + viem + RainbowKit) |
| `bot/` | Draw-keeper cron bot + GitHub Actions workflow |

## How it works

1. **Buy tickets** — `buyTickets(bundleId)` with the exact DOGE value. Default bundles (owner-configurable via `setBundles`): 1 ticket = 20 DOGE, 5 = 90, 10 = 170. Tickets are stored as cumulative ranges, so a 10,000-ticket purchase costs the same gas/storage as 1.
2. **Draw, every 30 days, permissionless** — DogeOS has no keeper network, so instead of a privileged cron, *anyone* can trigger the draw once the round ends and earn a 1 DOGE bounty (paid from the fee, never from the prize):
   - `commitDraw()` settles the prior round's expired prize into the jackpot (exactly once), closes sales, and pins a block ~10 blocks ahead;
   - `finalizeDraw()` derives the winning ticket from that block's hash, **escrows** the prize as a claim, pays the treasury (fee − bounty) and the caller (bounty), then opens the next round.
   - The `bot/` cron is a backstop that calls these if nobody else does. GitHub cron is best-effort; eventual execution is guaranteed only while a funded bot or any independent caller submits transactions.
3. **Winner claims, and pays gas** — the prize is never pushed. `claimPrize(roundId)` is winner-only, one-time, and valid **strictly before the claim cutoff**: the next round's scheduled end time, fixed the moment that round opens. Admin changes (e.g. `setDrawInterval`) can never move an existing cutoff. A claim whose transfer fails reverts — the claim is never burned.
4. **Unclaimed prizes roll** — at the next round's commit, an expired prize is extinguished and added to that round's gross pot, exactly once. Previously claimed amounts never roll. If a round has no tickets, no winner is drawn, no fee is charged, and the carried jackpot survives (through any number of empty rounds) until a ticketed draw happens.
5. **Fees** — each round snapshots `feeBps` (default 5%, hard cap 10%) when it opens, so the owner cannot re-fee an active pot. The fee applies to the **full gross pot — new ticket revenue plus rollover** (rolled funds are deliberately charged again). Exact example:

   | | Round 1 | Round 2 (R1 unclaimed) |
   |---|---|---|
   | New ticket revenue | 1,000.00 DOGE | 1,000.00 DOGE |
   | Expired prize added | 0.00 | 950.00 |
   | **Draw pot** | **1,000.00** | **1,950.00** |
   | 5% protocol fee | 50.00 | 97.50 |
   | 1 DOGE finalizer bounty | from fee | from fee |
   | Treasury net receipt | 49.00 | 96.50 |
   | **Winner claimable** | **950.00** | **1,852.50** |

6. **Fail-closed** — `pause()` stops ticket **sales only**; draws, claims and withdrawals can never be paused. Failed treasury/bounty pushes credit a pull-based `withdrawable` balance. The owner can never sweep the pot, an awarded claim, or anyone's balance. Value conservation (every wei of tickets = claims + rollover + fee + bounty) is enforced by tests at wei precision.

### Randomness: trust model — launch blocker (read this)

DogeOS has **no VRF oracle** (Chainlink VRF does not support DogeOS), and **`PREVRANDAO` returns 0 on DogeOS**, so the draw seeds from the hash of a block pinned *after* ticket sales close (commit → finalize). Buyers cannot predict or influence the outcome. **However:** the 256-block hash-retrieval window plus permissionless late recommit make liveness fragile and may allow selective timing/abort bias, and the rollup's sequencer can in principle influence block hashes. Solidity's own docs warn against block hashes as secure randomness. **This is not a verified fair-money lottery today.** Real-value launch stays blocked until the randomness is replaced with an independently verifiable scheme (a VRF service on DogeOS is planned as a follow-up) and jurisdictional/legal clearance is in place. If the pinned block ages past the hash window before anyone finalizes, the commitment automatically re-pins — the draw can never strand.

## Development

```bash
# contracts (requires Foundry: https://getfoundry.sh)
cd contracts
forge test          # 37 tests: claims, rollover, boundary races, exact fee
                    # arithmetic, fuzz conservation, fairness, reentrancy

# frontend
cd web
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_RAFFLE_ADDRESS + WalletConnect project id
npm run dev
```

## Deploy to Chikyū testnet

> Solidity bytecode changes require deploying a **new** contract — an already
> deployed immutable contract cannot be patched. Before migrating off a prior
> deployment, check it for current deposits/claims and let them settle.

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...   # fund it at https://faucet.testnet.dogeos.com
export RAFFLE_TREASURY=0x...        # receives the fee (defaults to deployer)
forge script script/Deploy.s.sol --rpc-url dogeos_testnet --broadcast
```

Chain: id `6281971`, RPC `https://rpc.testnet.dogeos.com/`, explorer [dogeos-testnet.l2scan.co](https://dogeos-testnet.l2scan.co). Contracts compile with Solidity 0.8.31 / `osaka` EVM target per the [DogeOS docs](https://docs.dogeos.com/en/developers/ethereum-and-dogeos-differences).

Then set repo Actions config for the backstop bot: variable `RAFFLE_ADDRESS`, secret `BOT_PRIVATE_KEY` (a throwaway hot wallet with a little testnet DOGE for gas), and update `NEXT_PUBLIC_RAFFLE_ADDRESS` for the web app.

## Legal

A paid-entry raffle is regulated gambling/lottery activity in most jurisdictions. This repository is a testnet technology demonstration; obtain legal advice before operating it for real value.

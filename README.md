# Doge Raffle 🐕

A recurring native-DOGE raffle dApp for **DogeOS** (the EVM ZK-rollup app layer for Dogecoin). Users connect a wallet and buy tickets with DOGE; every 30 days a winner is drawn, weighted by tickets held, and automatically receives the pot minus a 5% protocol fee.

> **Status: DogeOS Chikyū testnet only.** DogeOS mainnet has not launched; when it does, deployment is a config change (new RPC/chain id).

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry project: `DogeRaffle.sol`, tests, deploy script |
| `web/` | Next.js frontend (wagmi + viem + RainbowKit) |
| `bot/` | Draw-keeper cron bot + GitHub Actions workflow |

## How it works

1. **Buy tickets** — `buyTickets(bundleId)` with the exact DOGE value. Default bundles (owner-configurable via `setBundles`): 1 ticket = 20 DOGE, 5 = 90, 10 = 170. Tickets are stored as cumulative ranges, so a 10,000-ticket purchase costs the same gas/storage as 1.
2. **Draw, every 30 days, permissionless** — DogeOS has no keeper network, so instead of a privileged cron, *anyone* can trigger the draw once the round ends and earn a 1 DOGE bounty (paid from the fee):
   - `commitDraw()` closes sales and pins a block ~10 blocks in the future;
   - `finalizeDraw()` derives the winning ticket from that block's hash, pays the winner (pot − 5% fee), the treasury (fee − bounty), and the caller (bounty), then opens the next round.
   - The `bot/` cron is just a backstop that calls these if nobody else does.
3. **Fail-closed payouts** — any payout whose push transfer fails is credited to `withdrawable[addr]` and claimable via `withdrawPayout()`; a reverting recipient can never block a draw. `pause()` stops ticket **sales only** — draws and withdrawals can never be paused, so the admin can never trap user funds. Fee is hard-capped at 10%.

### Randomness: trust model (read this)

DogeOS has **no VRF oracle today, and `PREVRANDAO` returns 0 on DogeOS**, so the draw seeds from the hash of a block pinned *after* ticket sales close (commit → finalize). Buyers cannot predict or influence the outcome. Residual assumption: the rollup's sequencer could in principle influence block hashes. This is a known, documented limitation acceptable for testnet; the randomness derivation is isolated so a VRF can be swapped in when one exists on DogeOS. If the pinned block ages past the 256-block hash window before anyone finalizes, the commitment automatically re-pins — the draw can never strand.

## Development

```bash
# contracts (requires Foundry: https://getfoundry.sh)
cd contracts
forge test          # 22 tests: unit, fuzz, statistical fairness, reentrancy

# frontend
cd web
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_RAFFLE_ADDRESS + WalletConnect project id
npm run dev
```

## Deploy to Chikyū testnet

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...   # fund it at https://faucet.testnet.dogeos.com
export RAFFLE_TREASURY=0x...        # receives the 5% fee (defaults to deployer)
forge script script/Deploy.s.sol --rpc-url dogeos_testnet --broadcast
```

Chain: id `6281971`, RPC `https://rpc.testnet.dogeos.com/`, explorer [dogeos-testnet.l2scan.co](https://dogeos-testnet.l2scan.co). Contracts compile with Solidity 0.8.31 / `osaka` EVM target per the [DogeOS docs](https://docs.dogeos.com/en/developers/ethereum-and-dogeos-differences).

Then set repo Actions config for the backstop bot: variable `RAFFLE_ADDRESS`, secret `BOT_PRIVATE_KEY` (a throwaway hot wallet with a little testnet DOGE for gas).

## Legal

A paid-entry raffle is regulated gambling/lottery activity in most jurisdictions. This repository is a testnet technology demonstration; obtain legal advice before operating it for real value.

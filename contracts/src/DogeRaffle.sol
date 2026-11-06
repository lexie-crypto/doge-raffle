// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVRFConsumer} from "./vrf/IVRFConsumer.sol";

interface IVRFCoordinator {
    function requestRandomness(bytes32 userSeed) external payable returns (uint256 requestId);
}

/// @title DogeRaffle — recurring native-DOGE raffle for DogeOS
///       (claimable prizes + rolling jackpot model)
///
/// Users buy tickets with native DOGE. Every `drawInterval` (default 30 days)
/// a winner is drawn, weighted by tickets held. The prize is NOT pushed: it is
/// escrowed and only the winner can claim it (paying their own gas), strictly
/// before an immutable claim cutoff — the scheduled end of the next round,
/// fixed the moment that round opens. An unclaimed prize is extinguished at
/// the next round's close and rolled into that round's jackpot exactly once.
///
/// Fees: every ticketed draw charges `feeBps` (snapshotted when the round
/// opens, default 5%, hard-capped at 10%) on the FULL gross pot — new ticket
/// revenue plus any rolled-over prize money (rollover funds are deliberately
/// charged again). A fixed bounty, paid out of the fee, rewards whoever calls
/// the draw, so the draw is permissionless and needs no privileged keeper.
/// Rounds with no tickets charge no fee and carry any rolled jackpot forward.
///
/// Randomness: primary source is DogeVRFCoordinator (on-chain-verified ECVRF
/// — unforgeable by oracle and sequencer alike). commitDraw requests a VRF
/// output; the coordinator's verified callback settles the draw. If the
/// oracle stays silent past `vrfTimeout`, the permissionless blockhash path
/// (commit + future blockhash, since PREVRANDAO returns 0 on DogeOS) settles
/// instead, so a withholding oracle can delay a draw but never abort it —
/// and the delay is publicly visible on-chain. With no coordinator set, the
/// blockhash path runs alone (testnet bootstrap mode; not fit for real value).
///
/// Fail-closed guarantees:
///  - pause() stops ticket SALES only; draws, claims and withdrawals can
///    never be paused.
///  - A winner's claim that fails to transfer REVERTS (the claim is never
///    burned). Failed treasury/bounty pushes are credited to a pull-based
///    balance ({withdrawable}, claimed via {withdrawPayout}).
///  - Late claims fail deterministically by timestamp even if no transaction
///    has settled the expiry yet; a claim before the cutoff and a rollover at
///    or after it can never both consume the same funds.
///  - The owner can change prices/fee/interval for FUTURE rounds, but can
///    never touch an active pot, an awarded claim, or anyone's withdrawable
///    balance, and can never shorten an existing claim window.
contract DogeRaffle is Ownable2Step, Pausable, ReentrancyGuard, IVRFConsumer {
    // ---------------------------------------------------------------- types

    enum RoundStatus {
        Open, // selling tickets
        Committed, // sales closed, waiting for the randomness block
        Finalized // winner drawn (or empty round rolled); round is history
    }

    enum PrizeStatus {
        None,
        Claimable, // escrowed, waiting for the winner (may be past cutoff but unsettled)
        Claimed, // winner withdrew it
        RolledOver // expired unclaimed; moved into a later jackpot
    }

    struct Bundle {
        uint32 tickets; // tickets granted
        uint224 price; // total price in wei of DOGE
    }

    /// Ticket ownership is stored as cumulative ranges: a purchase of N
    /// tickets appends one entry whose `cumulative` is the running total.
    /// Winner lookup is a binary search — O(log n) in number of purchases,
    /// and buying 10,000 tickets costs the same storage as buying 1.
    struct Entry {
        address buyer;
        uint96 cumulative;
    }

    struct Round {
        uint64 startTime;
        uint64 endTime;
        uint64 randomnessBlock; // block whose hash seeds the draw (set on commit)
        RoundStatus status;
        uint16 feeBps; // fee snapshotted at round open — immutable for this pot
        uint96 totalTickets;
        uint256 pot; // NEW ticket revenue only (rollover tracked in pendingCarry)
        address winner;
    }

    struct Prize {
        uint256 amount; // claimable DOGE (gross pot minus fee)
        uint64 claimCutoff; // strict deadline: claim valid only while now < cutoff
        PrizeStatus status;
    }

    // ---------------------------------------------------------------- state

    uint256 public constant MAX_FEE_BPS = 1000; // 10% hard cap
    uint256 public constant BPS = 10_000;
    uint64 public constant MIN_DRAW_INTERVAL = 10 minutes;
    uint64 public constant RANDOMNESS_DELAY = 10; // blocks between commit and draw

    uint256 public feeBps = 500; // 5% — applied to rounds opened after a change
    uint64 public drawInterval = 30 days;
    uint256 public callerBounty = 1 ether; // 1 DOGE, paid from the fee
    address public treasury;

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Prize) public prizes;
    mapping(uint256 => Entry[]) private _entries;
    mapping(uint256 => mapping(address => uint256)) public ticketsOf;

    Bundle[] public bundles;

    /// Expired, unclaimed jackpot value awaiting the next TICKETED draw.
    /// Survives any number of empty rounds without fee or loss.
    uint256 public pendingCarry;

    /// Treasury/bounty payouts whose push transfer failed. Claim with
    /// {withdrawPayout}. Winner prizes never land here — they live in
    /// {prizes} with a deadline and are claimed via {claimPrize}.
    mapping(address => uint256) public withdrawable;

    /// VRF integration (optional: zero coordinator = blockhash-only mode).
    address public vrfCoordinator;
    uint64 public vrfTimeout = 6 hours; // fallback delay before blockhash settles
    mapping(uint256 => uint256) public vrfRequestOf; // roundId => requestId
    mapping(uint256 => uint256) public roundOfRequest; // requestId => roundId
    mapping(uint256 => uint64) public committedAt; // roundId => commit timestamp

    // --------------------------------------------------------------- events

    event TicketsPurchased(
        uint256 indexed roundId, address indexed buyer, uint256 bundleId, uint256 tickets, uint256 paid
    );
    event DrawCommitted(uint256 indexed roundId, uint64 randomnessBlock);
    event DrawRecommitted(uint256 indexed roundId, uint64 randomnessBlock);
    event WinnerDrawn(
        uint256 indexed roundId,
        address indexed winner,
        uint256 prize,
        uint256 fee,
        uint256 grossPot,
        uint256 totalTickets
    );
    event PrizeClaimable(uint256 indexed roundId, address indexed winner, uint256 amount, uint64 claimCutoff);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PrizeRolledOver(uint256 indexed roundId, uint256 amount, uint256 indexed intoRoundId);
    event EmptyRoundRolledOver(uint256 indexed roundId, uint256 carriedJackpot);
    event RoundStarted(uint256 indexed roundId, uint64 startTime, uint64 endTime, uint16 feeBps);
    event PayoutCredited(address indexed to, uint256 amount);
    event PayoutWithdrawn(address indexed to, uint256 amount);
    event BundlesSet(Bundle[] bundles);
    event FeeBpsSet(uint256 feeBps);
    event DrawIntervalSet(uint64 drawInterval);
    event CallerBountySet(uint256 bounty);
    event TreasurySet(address treasury);
    event VrfRequested(uint256 indexed roundId, uint256 indexed requestId);
    event VrfCoordinatorSet(address coordinator);
    event VrfTimeoutSet(uint64 timeout);

    // --------------------------------------------------------------- errors

    error RoundNotOpen();
    error RoundNotCommitted();
    error SalesClosed();
    error RoundStillRunning();
    error RandomnessNotReady();
    error WrongPayment(uint256 expected, uint256 sent);
    error InvalidBundle();
    error NoBundles();
    error FeeTooHigh();
    error IntervalTooShort();
    error ZeroAddress();
    error NothingToWithdraw();
    error DirectTransfersNotAccepted();
    error NotWinner();
    error PrizeNotClaimable();
    error ClaimExpired();
    error ClaimTransferFailed();
    error OnlyCoordinator();
    error StaleVrfResponse();
    error VrfStillPending();
    error TimeoutTooShort();

    // ---------------------------------------------------------- constructor

    constructor(address initialOwner, address treasury_) Ownable(initialOwner) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;

        // Default pricing (owner-configurable via setBundles):
        // 1 ticket = 20 DOGE, 5 = 90 (10% off), 10 = 170 (15% off)
        bundles.push(Bundle({tickets: 1, price: 20 ether}));
        bundles.push(Bundle({tickets: 5, price: 90 ether}));
        bundles.push(Bundle({tickets: 10, price: 170 ether}));

        _startRound();
    }

    /// Plain DOGE transfers are rejected so the pot always equals ticket
    /// revenue and accounting stays exact. (Forced transfers — e.g. via a
    /// pre-funded address — can still raise the raw balance; all accounting
    /// uses internal tallies, never address(this).balance.)
    receive() external payable {
        revert DirectTransfersNotAccepted();
    }

    // ----------------------------------------------------------- buy flow

    function buyTickets(uint256 bundleId) external payable nonReentrant whenNotPaused {
        Round storage round = rounds[currentRoundId];
        if (round.status != RoundStatus.Open) revert RoundNotOpen();
        if (block.timestamp >= round.endTime) revert SalesClosed();
        if (bundleId >= bundles.length) revert InvalidBundle();

        Bundle memory bundle = bundles[bundleId];
        if (msg.value != bundle.price) revert WrongPayment(bundle.price, msg.value);

        uint96 newTotal = round.totalTickets + bundle.tickets;
        round.totalTickets = newTotal;
        round.pot += msg.value;
        ticketsOf[currentRoundId][msg.sender] += bundle.tickets;
        _entries[currentRoundId].push(Entry({buyer: msg.sender, cumulative: newTotal}));

        emit TicketsPurchased(currentRoundId, msg.sender, bundleId, bundle.tickets, msg.value);
    }

    // ----------------------------------------------------------- draw flow

    /// Step 1: close sales once the round has run its interval, settle the
    /// PRIOR round's expired prize into the jackpot (exactly once), and pin a
    /// future block as the randomness source. Permissionless.
    /// An empty round (no tickets) is rolled straight into a new round with
    /// no fee, no bounty, and the carried jackpot preserved.
    function commitDraw() external nonReentrant {
        uint256 roundId = currentRoundId;
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.Open) revert RoundNotOpen();
        if (block.timestamp < round.endTime) revert RoundStillRunning();

        // Settle the previous round's prize now that this round's deadline
        // (== that prize's claim cutoff) has passed. Rolls at most once:
        // status moves Claimable -> RolledOver.
        _settleExpiredPrize(roundId);

        if (round.totalTickets == 0) {
            round.status = RoundStatus.Finalized;
            emit EmptyRoundRolledOver(roundId, pendingCarry);
            _startRound();
            return;
        }

        round.status = RoundStatus.Committed;
        round.randomnessBlock = uint64(block.number) + RANDOMNESS_DELAY; // fallback pin
        committedAt[roundId] = uint64(block.timestamp);
        emit DrawCommitted(roundId, round.randomnessBlock);

        // Primary path: request verified randomness (raffle is fee-exempt).
        if (vrfCoordinator != address(0)) {
            uint256 requestId = IVRFCoordinator(vrfCoordinator).requestRandomness(bytes32(roundId));
            vrfRequestOf[roundId] = requestId;
            roundOfRequest[requestId] = roundId;
            emit VrfRequested(roundId, requestId);
        }
    }

    /// Coordinator callback: settle the draw with the verified VRF output.
    /// No bounty on this path — the oracle is compensated by the protocol.
    function rawFulfillRandomness(uint256 requestId, uint256 randomness) external nonReentrant {
        if (msg.sender != vrfCoordinator) revert OnlyCoordinator();
        uint256 roundId = roundOfRequest[requestId];
        if (roundId == 0 || roundId != currentRoundId) revert StaleVrfResponse();
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.Committed) revert StaleVrfResponse();
        _settleDraw(roundId, randomness, address(0));
    }

    /// Fallback draw using the pinned block's hash. Permissionless; the
    /// caller earns `callerBounty` (paid from the fee). With a VRF request
    /// pending, this path only opens after `vrfTimeout`, so a silent oracle
    /// delays a draw but can never abort it. If the pinned block has aged out
    /// of the 256-block hash window, the commitment is re-pinned instead of
    /// reverting, so the draw can never strand.
    function finalizeDraw() external nonReentrant {
        uint256 roundId = currentRoundId;
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.Committed) revert RoundNotCommitted();
        if (vrfRequestOf[roundId] != 0 && block.timestamp < committedAt[roundId] + vrfTimeout) {
            revert VrfStillPending();
        }
        if (block.number <= round.randomnessBlock) revert RandomnessNotReady();

        bytes32 seed = blockhash(round.randomnessBlock);
        if (seed == bytes32(0)) {
            // hash window expired — re-pin and let anyone try again
            round.randomnessBlock = uint64(block.number) + RANDOMNESS_DELAY;
            emit DrawRecommitted(roundId, round.randomnessBlock);
            return;
        }

        uint256 randomness =
            uint256(keccak256(abi.encodePacked(seed, roundId, round.totalTickets, address(this))));
        _settleDraw(roundId, randomness, msg.sender);
    }

    /// Shared settlement: pick the winner from `randomness`, escrow the
    /// prize, pay treasury (and the bounty when `bountyTo` is nonzero), and
    /// open the next round. The prize is ESCROWED as a claim, never pushed.
    function _settleDraw(uint256 roundId, uint256 randomness, address bountyTo) private {
        Round storage round = rounds[roundId];
        uint96 totalTickets = round.totalTickets;
        uint256 winningTicket = randomness % totalTickets;
        address winner = _ownerOfTicket(roundId, winningTicket);

        // Gross pot = new ticket revenue + all eligible rollover. The fee is
        // deliberately charged on the FULL gross, including rolled funds.
        uint256 gross = round.pot + pendingCarry;
        pendingCarry = 0;
        uint256 fee = (gross * round.feeBps) / BPS;
        uint256 bounty = bountyTo == address(0) ? 0 : (callerBounty < fee ? callerBounty : fee);
        uint256 prizeAmount = gross - fee;

        round.status = RoundStatus.Finalized;
        round.winner = winner;
        prizes[roundId] = Prize({amount: prizeAmount, claimCutoff: 0, status: PrizeStatus.Claimable});

        emit WinnerDrawn(roundId, winner, prizeAmount, fee, gross, totalTickets);

        // Open the next round, then fix this prize's cutoff to its scheduled
        // end — immutable from here on, whatever happens to drawInterval.
        _startRound();
        uint64 cutoff = rounds[currentRoundId].endTime;
        prizes[roundId].claimCutoff = cutoff;
        emit PrizeClaimable(roundId, winner, prizeAmount, cutoff);

        // interactions last (all state above is final)
        _pay(treasury, fee - bounty);
        if (bounty != 0) _pay(bountyTo, bounty);
    }

    // ------------------------------------------------------------- claims

    /// Winner-only, one-time, strictly before the cutoff. The winner pays
    /// gas. A failed transfer REVERTS — the claim is never burned. Works
    /// while paused.
    function claimPrize(uint256 roundId) external nonReentrant {
        Prize storage prize = prizes[roundId];
        if (msg.sender != rounds[roundId].winner) revert NotWinner();
        if (prize.status != PrizeStatus.Claimable) revert PrizeNotClaimable();
        if (block.timestamp >= prize.claimCutoff) revert ClaimExpired();

        prize.status = PrizeStatus.Claimed;
        uint256 amount = prize.amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert ClaimTransferFailed();
        emit PrizeClaimed(roundId, msg.sender, amount);
    }

    /// Move the prior round's prize into the jackpot if its cutoff has
    /// passed unclaimed. At most one prize can be outstanding (each round's
    /// prize is settled at the NEXT round's commit), so checking roundId-1
    /// is exhaustive.
    function _settleExpiredPrize(uint256 committingRoundId) private {
        if (committingRoundId < 2) return;
        uint256 prevId = committingRoundId - 1;
        Prize storage prize = prizes[prevId];
        if (prize.status == PrizeStatus.Claimable && block.timestamp >= prize.claimCutoff) {
            prize.status = PrizeStatus.RolledOver;
            pendingCarry += prize.amount;
            emit PrizeRolledOver(prevId, prize.amount, committingRoundId);
        }
    }

    // ------------------------------------------------------------- payouts

    /// Push a treasury/bounty payout; on any failure credit it for pull-based
    /// withdrawal. Never used for winner prizes.
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: 50_000}("");
        if (!ok) {
            withdrawable[to] += amount;
            emit PayoutCredited(to, amount);
        }
    }

    /// Claim treasury/bounty payouts whose push transfer failed. Never pausable.
    function withdrawPayout() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
        emit PayoutWithdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------ internal

    function _startRound() private {
        uint256 roundId = ++currentRoundId;
        Round storage round = rounds[roundId];
        round.startTime = uint64(block.timestamp);
        round.endTime = uint64(block.timestamp) + drawInterval;
        round.status = RoundStatus.Open;
        round.feeBps = uint16(feeBps); // snapshot: owner can't re-fee an active pot
        emit RoundStarted(roundId, round.startTime, round.endTime, round.feeBps);
    }

    /// Binary search over cumulative ticket ranges: first entry whose
    /// cumulative count exceeds `ticket` (0-indexed) owns it.
    function _ownerOfTicket(uint256 roundId, uint256 ticket) private view returns (address) {
        Entry[] storage entries = _entries[roundId];
        uint256 lo = 0;
        uint256 hi = entries.length - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (ticket < entries[mid].cumulative) {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        return entries[lo].buyer;
    }

    // --------------------------------------------------------------- admin

    /// Replace the bundle price list (affects purchases from the next tx on).
    function setBundles(Bundle[] calldata newBundles) external onlyOwner {
        if (newBundles.length == 0) revert NoBundles();
        delete bundles;
        for (uint256 i = 0; i < newBundles.length; i++) {
            if (newBundles[i].tickets == 0 || newBundles[i].price == 0) revert InvalidBundle();
            bundles.push(newBundles[i]);
        }
        emit BundlesSet(newBundles);
    }

    /// Applies to rounds OPENED after the change (each round snapshots its fee).
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeBpsSet(newFeeBps);
    }

    /// Applies to rounds STARTED after the current one ends. Never alters an
    /// existing prize's claim cutoff (cutoffs are stored at award time).
    function setDrawInterval(uint64 newInterval) external onlyOwner {
        if (newInterval < MIN_DRAW_INTERVAL) revert IntervalTooShort();
        drawInterval = newInterval;
        emit DrawIntervalSet(newInterval);
    }

    /// Set (or clear, with address(0)) the VRF coordinator. Takes effect at
    /// the next commit; a round already committed keeps the path it started
    /// with. The raffle must be fee-exempt on the coordinator.
    function setVrfCoordinator(address newCoordinator) external onlyOwner {
        vrfCoordinator = newCoordinator;
        emit VrfCoordinatorSet(newCoordinator);
    }

    /// Fallback delay before the blockhash path may settle a VRF round.
    function setVrfTimeout(uint64 newTimeout) external onlyOwner {
        if (newTimeout < 10 minutes) revert TimeoutTooShort();
        vrfTimeout = newTimeout;
        emit VrfTimeoutSet(newTimeout);
    }

    function setCallerBounty(uint256 newBounty) external onlyOwner {
        callerBounty = newBounty;
        emit CallerBountySet(newBounty);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }

    /// Pauses ticket SALES only. Draws, claims and withdrawals are
    /// deliberately not pausable, so user funds can never be trapped.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --------------------------------------------------------------- views

    function bundleCount() external view returns (uint256) {
        return bundles.length;
    }

    function allBundles() external view returns (Bundle[] memory) {
        return bundles;
    }

    function entryCount(uint256 roundId) external view returns (uint256) {
        return _entries[roundId].length;
    }

    function canCommit() external view returns (bool) {
        Round storage round = rounds[currentRoundId];
        return round.status == RoundStatus.Open && block.timestamp >= round.endTime;
    }

    /// True when the FALLBACK blockhash path may run (the VRF path needs no
    /// keeper — the coordinator callback settles it directly).
    function canFinalize() external view returns (bool) {
        uint256 roundId = currentRoundId;
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.Committed) return false;
        if (vrfRequestOf[roundId] != 0 && block.timestamp < committedAt[roundId] + vrfTimeout) {
            return false;
        }
        return block.number > round.randomnessBlock;
    }

    function prizeOf(uint256 roundId) external view returns (Prize memory) {
        return prizes[roundId];
    }

    /// DOGE the current draw is guaranteed to include: new ticket revenue
    /// plus rollover already settled on-chain.
    function guaranteedPot() public view returns (uint256) {
        return rounds[currentRoundId].pot + pendingCarry;
    }

    /// The prior round's prize if it could still roll into this draw:
    /// (amount, cutoff, stillClaimable). UI must present this as POSSIBLE
    /// rollover until the cutoff passes — the winner may still claim it.
    function pendingRollover() external view returns (uint256 amount, uint64 cutoff, bool stillClaimable) {
        if (currentRoundId < 2) return (0, 0, false);
        Prize storage prize = prizes[currentRoundId - 1];
        if (prize.status != PrizeStatus.Claimable) return (0, 0, false);
        return (prize.amount, prize.claimCutoff, block.timestamp < prize.claimCutoff);
    }

    function currentRound()
        external
        view
        returns (uint256 roundId, Round memory round, uint256 secondsUntilDraw)
    {
        roundId = currentRoundId;
        round = rounds[roundId];
        secondsUntilDraw = block.timestamp >= round.endTime ? 0 : round.endTime - block.timestamp;
    }
}

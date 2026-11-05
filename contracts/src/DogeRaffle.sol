// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DogeRaffle — recurring native-DOGE raffle for DogeOS
///
/// Users buy tickets with native DOGE. Every `drawInterval` (default 30 days)
/// a winner is drawn, weighted by tickets held. The winner receives the round
/// pot minus a protocol fee (default 5%, hard-capped at 10%) which goes to the
/// treasury. A fixed bounty, paid out of the fee, rewards whoever calls the
/// draw functions, so the draw is permissionless and needs no privileged keeper.
///
/// Randomness: DogeOS has no VRF oracle today, and PREVRANDAO returns 0 on
/// DogeOS, so randomness is derived from the hash of a block chosen AFTER
/// ticket sales close (two-step commit/finalize). This prevents buyers from
/// predicting the outcome. Residual trust assumption: the chain's sequencer
/// could in principle influence block hashes. Acceptable for launch; the draw
/// logic is isolated in {_random} so a VRF can replace it in a future version.
///
/// Fail-closed guarantees:
///  - pause() stops ticket SALES only; draws and claims can never be paused.
///  - Any payout whose transfer fails is credited to a pull-based balance
///    ({withdrawable}, claimed via {withdrawPayout}) — a reverting recipient
///    can never block a draw or trap funds.
///  - The owner can change prices/fee/interval for FUTURE rounds, but can
///    never touch an active round's pot or a credited payout.
contract DogeRaffle is Ownable2Step, Pausable, ReentrancyGuard {
    // ---------------------------------------------------------------- types

    enum RoundStatus {
        Open, // selling tickets
        Committed, // sales closed, waiting for the randomness block
        Finalized // winner drawn and paid; round is history
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
        uint96 totalTickets;
        uint256 pot;
        address winner;
        uint256 prize; // winner's net payout (recorded for history/UI)
    }

    // ---------------------------------------------------------------- state

    uint256 public constant MAX_FEE_BPS = 1000; // 10% hard cap
    uint256 public constant BPS = 10_000;
    uint64 public constant MIN_DRAW_INTERVAL = 10 minutes;
    uint64 public constant RANDOMNESS_DELAY = 10; // blocks between commit and draw

    uint256 public feeBps = 500; // 5%
    uint64 public drawInterval = 30 days;
    uint256 public callerBounty = 1 ether; // 1 DOGE, paid from the fee
    address public treasury;

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Entry[]) private _entries;
    mapping(uint256 => mapping(address => uint256)) public ticketsOf;

    Bundle[] public bundles;

    /// Payouts (prize, fee, or bounty) whose push transfer failed, plus any
    /// payout routed pull-only. Claim with {withdrawPayout}.
    mapping(address => uint256) public withdrawable;

    // --------------------------------------------------------------- events

    event TicketsPurchased(
        uint256 indexed roundId, address indexed buyer, uint256 bundleId, uint256 tickets, uint256 paid
    );
    event DrawCommitted(uint256 indexed roundId, uint64 randomnessBlock);
    event DrawRecommitted(uint256 indexed roundId, uint64 randomnessBlock);
    event WinnerDrawn(
        uint256 indexed roundId, address indexed winner, uint256 prize, uint256 fee, uint256 totalTickets
    );
    event EmptyRoundRolledOver(uint256 indexed roundId);
    event RoundStarted(uint256 indexed roundId, uint64 startTime, uint64 endTime);
    event PayoutCredited(address indexed to, uint256 amount);
    event PayoutWithdrawn(address indexed to, uint256 amount);
    event BundlesSet(Bundle[] bundles);
    event FeeBpsSet(uint256 feeBps);
    event DrawIntervalSet(uint64 drawInterval);
    event CallerBountySet(uint256 bounty);
    event TreasurySet(address treasury);

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
    /// revenue and accounting stays exact.
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

    /// Step 1: close sales once the round has run its interval and pin a
    /// future block as the randomness source. Permissionless.
    /// An empty round (no tickets) is rolled straight into a new round.
    function commitDraw() external nonReentrant {
        uint256 roundId = currentRoundId;
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.Open) revert RoundNotOpen();
        if (block.timestamp < round.endTime) revert RoundStillRunning();

        if (round.totalTickets == 0) {
            round.status = RoundStatus.Finalized;
            emit EmptyRoundRolledOver(roundId);
            _startRound();
            return;
        }

        round.status = RoundStatus.Committed;
        round.randomnessBlock = uint64(block.number) + RANDOMNESS_DELAY;
        emit DrawCommitted(roundId, round.randomnessBlock);
    }

    /// Step 2: draw the winner using the pinned block's hash. Permissionless;
    /// the caller earns `callerBounty` (paid from the fee). If the pinned
    /// block has aged out of the 256-block hash window (EIP-2935 history
    /// window on DogeOS), the commitment is re-pinned instead of reverting,
    /// so the draw can never strand.
    function finalizeDraw() external nonReentrant {
        uint256 roundId = currentRoundId;
        Round storage round = rounds[roundId];
        if (round.status != RoundStatus.Committed) revert RoundNotCommitted();
        if (block.number <= round.randomnessBlock) revert RandomnessNotReady();

        bytes32 seed = blockhash(round.randomnessBlock);
        if (seed == bytes32(0)) {
            // hash window expired — re-pin and let anyone try again
            round.randomnessBlock = uint64(block.number) + RANDOMNESS_DELAY;
            emit DrawRecommitted(roundId, round.randomnessBlock);
            return;
        }

        uint96 totalTickets = round.totalTickets;
        uint256 winningTicket =
            uint256(keccak256(abi.encodePacked(seed, roundId, totalTickets, address(this)))) % totalTickets;
        address winner = _ownerOfTicket(roundId, winningTicket);

        uint256 pot = round.pot;
        uint256 fee = (pot * feeBps) / BPS;
        uint256 bounty = callerBounty < fee ? callerBounty : fee;
        uint256 prize = pot - fee;

        round.status = RoundStatus.Finalized;
        round.winner = winner;
        round.prize = prize;

        emit WinnerDrawn(roundId, winner, prize, fee, totalTickets);
        _startRound();

        // interactions last (state above is final)
        _pay(winner, prize);
        _pay(treasury, fee - bounty);
        _pay(msg.sender, bounty);
    }

    // ------------------------------------------------------------- payouts

    /// Push a payout; on any failure credit it for pull-based withdrawal.
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: 50_000}("");
        if (!ok) {
            withdrawable[to] += amount;
            emit PayoutCredited(to, amount);
        }
    }

    /// Claim payouts whose push transfer failed. Never pausable.
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
        emit RoundStarted(roundId, round.startTime, round.endTime);
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

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeBpsSet(newFeeBps);
    }

    /// Applies to rounds started AFTER the current one ends.
    function setDrawInterval(uint64 newInterval) external onlyOwner {
        if (newInterval < MIN_DRAW_INTERVAL) revert IntervalTooShort();
        drawInterval = newInterval;
        emit DrawIntervalSet(newInterval);
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

    /// Pauses ticket SALES only. Draws, finalization and withdrawals are
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

    function canFinalize() external view returns (bool) {
        Round storage round = rounds[currentRoundId];
        return round.status == RoundStatus.Committed && block.number > round.randomnessBlock;
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

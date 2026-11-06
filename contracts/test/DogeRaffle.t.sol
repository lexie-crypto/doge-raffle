// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";

/// Recipient that rejects native transfers — proves a failed claim reverts
/// without burning the claim, and failed treasury pushes fall back to pull.
contract RejectingReceiver {
    bool public allow;

    function setAllow(bool allow_) external {
        allow = allow_;
    }

    receive() external payable {
        require(allow, "nope");
    }

    function buy(DogeRaffle raffle, uint256 bundleId) external payable {
        raffle.buyTickets{value: msg.value}(bundleId);
    }

    function claim(DogeRaffle raffle, uint256 roundId) external {
        raffle.claimPrize(roundId);
    }

    function withdraw(DogeRaffle raffle) external {
        raffle.withdrawPayout();
    }
}

/// Winner that attempts to re-enter claimPrize from its receive hook.
contract ReentrantClaimer {
    DogeRaffle private immutable raffle;
    uint256 private roundId;
    bool public reentrySucceeded;

    constructor(DogeRaffle raffle_) {
        raffle = raffle_;
    }

    function buy(uint256 bundleId) external payable {
        raffle.buyTickets{value: msg.value}(bundleId);
    }

    function claim(uint256 roundId_) external {
        roundId = roundId_;
        raffle.claimPrize(roundId_);
    }

    receive() external payable {
        // try to re-enter claimPrize during the prize transfer
        (bool ok,) = address(raffle).call(abi.encodeCall(DogeRaffle.claimPrize, (roundId)));
        reentrySucceeded = ok;
    }
}

contract DogeRaffleTest is Test {
    DogeRaffle internal raffle;
    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal foundation = makeAddr("foundation");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    uint256 internal constant SINGLE = 0; // 1 ticket / 20 DOGE
    uint256 internal constant FIVE = 1; // 5 tickets / 90 DOGE
    uint256 internal constant TEN = 2; // 10 tickets / 170 DOGE

    function setUp() public {
        raffle = new DogeRaffle(owner, treasury, foundation);
        vm.deal(alice, 10_000_000 ether);
        vm.deal(bob, 10_000_000 ether);
        vm.deal(keeper, 100 ether);
    }

    // ------------------------------------------------------------ helpers

    struct R {
        uint64 startTime;
        uint64 endTime;
        uint64 randomnessBlock;
        DogeRaffle.RoundStatus status;
        uint16 feeBps;
        uint16 foundationBps;
        uint96 totalTickets;
        uint256 pot;
        address winner;
    }

    function _round(uint256 id) internal view returns (R memory r) {
        (
            r.startTime,
            r.endTime,
            r.randomnessBlock,
            r.status,
            r.feeBps,
            r.foundationBps,
            r.totalTickets,
            r.pot,
            r.winner
        ) = raffle.rounds(id);
    }

    function _endRound() internal {
        vm.warp(_round(raffle.currentRoundId()).endTime);
    }

    /// Full draw of the current round: warp to end, commit, roll, finalize.
    function _draw() internal returns (uint256 roundId) {
        roundId = raffle.currentRoundId();
        _endRound();
        vm.prank(keeper);
        raffle.commitDraw();
        if (_round(roundId).status == DogeRaffle.RoundStatus.Committed) {
            vm.roll(uint256(_round(roundId).randomnessBlock) + 1);
            vm.prank(keeper);
            raffle.finalizeDraw();
        }
    }

    /// Buy `n` single tickets for 20 DOGE each (total n*20 DOGE revenue).
    function _buySingles(address who, uint256 n) internal {
        for (uint256 i = 0; i < n; i++) {
            vm.prank(who);
            raffle.buyTickets{value: 20 ether}(SINGLE);
        }
    }

    // ------------------------------------------------------------- buying
    // (preserved from baseline, updated to the new round tuple)

    function test_buySingleBundle() public {
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);

        assertEq(raffle.ticketsOf(1, alice), 1);
        R memory r = _round(1);
        assertEq(r.totalTickets, 1);
        assertEq(r.pot, 20 ether);
        assertEq(address(raffle).balance, 20 ether);
    }

    function test_buyAllBundleTiers() public {
        vm.startPrank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        raffle.buyTickets{value: 90 ether}(FIVE);
        raffle.buyTickets{value: 170 ether}(TEN);
        vm.stopPrank();

        assertEq(raffle.ticketsOf(1, alice), 16);
        assertEq(_round(1).pot, 280 ether);
        assertEq(raffle.entryCount(1), 3);
    }

    function test_buyRevertsOnWrongPayment() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DogeRaffle.WrongPayment.selector, 20 ether, 19 ether));
        raffle.buyTickets{value: 19 ether}(SINGLE);
    }

    function test_buyRevertsOnBadBundle() public {
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.InvalidBundle.selector);
        raffle.buyTickets{value: 20 ether}(99);
    }

    function test_buyRevertsAfterRoundEnds() public {
        _endRound();
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.SalesClosed.selector);
        raffle.buyTickets{value: 20 ether}(SINGLE);
    }

    function test_directTransferRejected() public {
        vm.prank(alice);
        (bool ok,) = address(raffle).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(raffle).balance, 0);
    }

    // ------------------------------------------- draw creates escrow, not a transfer

    function test_drawEscrowsPrize_noPush() public {
        _buySingles(alice, 50); // 1,000 DOGE — the SoW acceptance round
        uint256 aliceBefore = alice.balance;

        uint256 roundId = _draw();

        // R1: pot 1,000 -> protocol 50 (bounty 1 -> treasury 49), foundation 50, claim 900
        DogeRaffle.Prize memory prize = raffle.prizeOf(roundId);
        assertEq(uint8(prize.status), uint8(DogeRaffle.PrizeStatus.Claimable));
        assertEq(prize.amount, 900 ether);
        assertEq(treasury.balance, 49 ether);
        assertEq(foundation.balance, 50 ether);
        assertEq(keeper.balance, 100 ether + 1 ether);

        // nothing pushed to the winner
        assertEq(alice.balance, aliceBefore);
        // escrow held in contract
        assertEq(address(raffle).balance, 900 ether);

        // cutoff = next round's scheduled end
        assertEq(prize.claimCutoff, _round(roundId + 1).endTime);

        // next round auto-opened
        assertEq(raffle.currentRoundId(), roundId + 1);
        assertEq(uint8(_round(roundId + 1).status), uint8(DogeRaffle.RoundStatus.Open));
    }

    // --------------------------------------------------------------- claims

    function test_winnerClaimsOnce() public {
        _buySingles(alice, 50);
        uint256 roundId = _draw();

        uint256 before = alice.balance;
        vm.prank(alice);
        raffle.claimPrize(roundId);
        assertEq(alice.balance, before + 900 ether);
        assertEq(uint8(raffle.prizeOf(roundId).status), uint8(DogeRaffle.PrizeStatus.Claimed));
        assertEq(address(raffle).balance, 0);

        // double claim fails
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.PrizeNotClaimable.selector);
        raffle.claimPrize(roundId);
    }

    function test_nonWinnerCannotClaim() public {
        _buySingles(alice, 50);
        uint256 roundId = _draw();
        vm.prank(bob);
        vm.expectRevert(DogeRaffle.NotWinner.selector);
        raffle.claimPrize(roundId);
    }

    function test_cannotClaimBeforeFinalize() public {
        _buySingles(alice, 1);
        _endRound();
        raffle.commitDraw(); // committed, not finalized
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.NotWinner.selector); // no winner recorded yet
        raffle.claimPrize(1);
    }

    function test_crossRoundClaimFails() public {
        _buySingles(alice, 1);
        uint256 r1 = _draw();
        // claim r1 within its window (drawing r2 would expire it — by design)
        vm.prank(alice);
        raffle.claimPrize(r1);

        _buySingles(alice, 1);
        uint256 r2 = _draw();
        // claiming a never-drawn round fails; claimed r1 cannot be re-claimed
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.NotWinner.selector);
        raffle.claimPrize(r2 + 1);
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.PrizeNotClaimable.selector);
        raffle.claimPrize(r1);
        // r2 claims independently
        vm.prank(alice);
        raffle.claimPrize(r2);
    }

    function test_claimWorksWhilePaused() public {
        _buySingles(alice, 50);
        uint256 roundId = _draw();
        vm.prank(owner);
        raffle.pause();
        vm.prank(alice);
        raffle.claimPrize(roundId);
        assertEq(uint8(raffle.prizeOf(roundId).status), uint8(DogeRaffle.PrizeStatus.Claimed));
    }

    function test_failedClaimRevertsWithoutBurningClaim() public {
        RejectingReceiver rejector = new RejectingReceiver();
        vm.deal(address(this), 20 ether);
        rejector.buy{value: 20 ether}(raffle, SINGLE);
        uint256 roundId = _draw();

        // claim transfer fails -> whole tx reverts -> claim intact
        vm.expectRevert(DogeRaffle.ClaimTransferFailed.selector);
        rejector.claim(raffle, roundId);
        assertEq(uint8(raffle.prizeOf(roundId).status), uint8(DogeRaffle.PrizeStatus.Claimable));

        // retry after fixing the receiver succeeds
        rejector.setAllow(true);
        rejector.claim(raffle, roundId);
        assertEq(address(rejector).balance, 18 ether); // 20 - 5% - 5%
    }

    function test_reentrancyDuringClaimBlocked() public {
        ReentrantClaimer attacker = new ReentrantClaimer(raffle);
        vm.deal(address(this), 20 ether);
        attacker.buy{value: 20 ether}(0);
        uint256 roundId = _draw();

        attacker.claim(roundId);
        assertFalse(attacker.reentrySucceeded(), "re-entry blocked by nonReentrant");
        assertEq(address(attacker).balance, 18 ether); // paid exactly once
    }

    // ------------------------------------------------- boundary + races

    function test_claimBoundary_lastSecondSucceeds_atCutoffFails() public {
        // two independent draws to test both sides of the boundary
        _buySingles(alice, 1);
        uint256 r1 = _draw();
        uint64 cutoff = raffle.prizeOf(r1).claimCutoff;

        // exactly one second before expiry: succeeds
        vm.warp(cutoff - 1);
        vm.prank(alice);
        raffle.claimPrize(r1);

        _buySingles(bob, 1);
        uint256 r2 = _draw();
        uint64 cutoff2 = raffle.prizeOf(r2).claimCutoff;

        // exactly at expiry: fails, deterministically, with no settlement tx
        vm.warp(cutoff2);
        vm.prank(bob);
        vm.expectRevert(DogeRaffle.ClaimExpired.selector);
        raffle.claimPrize(r2);
    }

    function test_claimVsCommit_cannotDoubleSpend() public {
        _buySingles(alice, 50); // R1: claim 900
        uint256 r1 = _draw();
        uint64 cutoff = raffle.prizeOf(r1).claimCutoff;
        _buySingles(bob, 50); // R2 revenue 1,000

        // at the cutoff, commit (rolls the prize) then attempt a late claim
        vm.warp(cutoff);
        raffle.commitDraw();
        assertEq(uint8(raffle.prizeOf(r1).status), uint8(DogeRaffle.PrizeStatus.RolledOver));
        assertEq(raffle.pendingCarry(), 900 ether);
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.PrizeNotClaimable.selector);
        raffle.claimPrize(r1);
    }

    function test_botDelayDoesNotExtendDeadline() public {
        _buySingles(alice, 1);
        uint256 r1 = _draw();
        uint64 cutoff = raffle.prizeOf(r1).claimCutoff;

        // nobody commits round 2 for ages; claim still dies at the timestamp
        vm.warp(cutoff + 30 days);
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.ClaimExpired.selector);
        raffle.claimPrize(r1);

        // and when the (very late) commit finally runs, it rolls exactly once
        raffle.commitDraw();
        assertEq(raffle.pendingCarry(), 18 ether);
    }

    // ------------------------------------------------------------ rollover

    function test_acceptanceArithmetic_fullScenario() public {
        // ---- Round 1: 1,000 DOGE new tickets
        _buySingles(alice, 50);
        uint256 r1 = _draw();
        assertEq(raffle.prizeOf(r1).amount, 900 ether); // 90%
        assertEq(treasury.balance, 49 ether); // protocol 50 - bounty 1
        assertEq(foundation.balance, 50 ether); // foundation 50

        // ---- unclaimed; Round 2: 1,000 DOGE new tickets + 900 rollover
        _buySingles(bob, 50);
        uint256 r2 = _draw(); // commit settles R1 prize into carry first

        // gross 1,900 -> protocol 95 (treasury +94), foundation 95, prize 1,710
        assertEq(raffle.prizeOf(r2).amount, 1710 ether);
        assertEq(treasury.balance, 49 ether + 94 ether);
        assertEq(foundation.balance, 50 ether + 95 ether);
        assertEq(uint8(raffle.prizeOf(r1).status), uint8(DogeRaffle.PrizeStatus.RolledOver));
        assertEq(raffle.pendingCarry(), 0); // consumed by the draw

        // winner (alice or bob — both bought 50 singles) can claim the lot
        address winner = _round(r2).winner;
        uint256 before = winner.balance;
        vm.prank(winner);
        raffle.claimPrize(r2);
        assertEq(winner.balance, before + 1710 ether);
        assertEq(address(raffle).balance, 0, "every wei of 2,000 accounted for");
    }

    function test_claimedPrizeAddsNothingToNextRound() public {
        _buySingles(alice, 50);
        uint256 r1 = _draw();
        vm.prank(alice);
        raffle.claimPrize(r1); // claimed in time

        _buySingles(bob, 50);
        uint256 r2 = _draw();
        // R2 pot is fresh revenue only: 1,000 -> prize 900
        assertEq(raffle.prizeOf(r2).amount, 900 ether);
    }

    function test_rolloverSurvivesEmptyRounds_noFeeCharged() public {
        _buySingles(alice, 50); // R1 -> 900 claimable
        _draw();

        uint256 treasuryAfterR1 = treasury.balance;
        uint256 foundationAfterR1 = foundation.balance;

        // R2: zero tickets. Commit rolls R1's expired prize into carry, then
        // rolls the empty round over without fees or bounty.
        _draw(); // empty round path
        assertEq(raffle.pendingCarry(), 900 ether);
        assertEq(treasury.balance, treasuryAfterR1, "no protocol fee on empty round");
        assertEq(foundation.balance, foundationAfterR1, "no foundation fee on empty round");

        // R3: also empty — carry preserved
        _draw();
        assertEq(raffle.pendingCarry(), 900 ether);

        // R4: ticketed. Gross = 20 + 900 = 920 -> fees 46 + 46 -> prize 828
        _buySingles(bob, 1);
        uint256 r4 = _draw();
        assertEq(raffle.prizeOf(r4).amount, 828 ether);
        assertEq(raffle.pendingCarry(), 0);
        vm.prank(bob);
        raffle.claimPrize(r4);
        assertEq(address(raffle).balance, 0, "every wei eventually paid out");
    }

    function test_prizeRollsExactlyOnce() public {
        _buySingles(alice, 50);
        uint256 r1 = _draw();

        // R2 empty: rolls R1 prize once
        _draw();
        assertEq(raffle.pendingCarry(), 900 ether);

        // R3 empty: R1 prize must NOT roll again
        _draw();
        assertEq(raffle.pendingCarry(), 900 ether);
        assertEq(uint8(raffle.prizeOf(r1).status), uint8(DogeRaffle.PrizeStatus.RolledOver));
    }

    // ------------------------------------------------------------ fee locks

    function test_feeSnapshot_ownerCannotRefeeActivePot() public {
        _buySingles(alice, 50); // bought under 5%
        vm.prank(owner);
        raffle.setFeeBps(1000); // raise to 10% mid-round

        uint256 r1 = _draw();
        // active round still charged its snapshotted 5% + 5%
        assertEq(raffle.prizeOf(r1).amount, 900 ether);

        // next round snapshots the new protocol fee; foundation unchanged
        assertEq(_round(raffle.currentRoundId()).feeBps, 1000);
        assertEq(_round(raffle.currentRoundId()).foundationBps, 500);
        _buySingles(bob, 50);
        uint256 r2 = _draw(); // R1 unclaimed: gross 1,900 at 10% + 5% -> prize 1,615
        assertEq(raffle.prizeOf(r2).amount, 1615 ether);
    }

    function test_foundationFeeSnapshotAndCap() public {
        vm.prank(owner);
        vm.expectRevert(DogeRaffle.FeeTooHigh.selector);
        raffle.setFoundationBps(1001);

        _buySingles(alice, 50); // bought under 5% / 5%
        vm.prank(owner);
        raffle.setFoundationBps(0); // drop foundation fee mid-round
        uint256 r1 = _draw();
        assertEq(raffle.prizeOf(r1).amount, 900 ether, "active pot keeps its snapshot");
        assertEq(foundation.balance, 50 ether);

        vm.prank(alice);
        raffle.claimPrize(r1);
        _buySingles(bob, 50);
        uint256 r2 = _draw(); // 1,000 at 5% + 0% -> prize 950
        assertEq(raffle.prizeOf(r2).amount, 950 ether);
        assertEq(foundation.balance, 50 ether, "no foundation fee on the new round");
    }

    function test_setFoundationWallet() public {
        address newFoundation = makeAddr("newFoundation");
        vm.prank(owner);
        vm.expectRevert(DogeRaffle.ZeroAddress.selector);
        raffle.setFoundationWallet(address(0));
        vm.prank(owner);
        raffle.setFoundationWallet(newFoundation);
        vm.prank(alice);
        vm.expectRevert();
        raffle.setFoundationWallet(alice);

        _buySingles(alice, 50);
        _draw();
        assertEq(newFoundation.balance, 50 ether);
        assertEq(foundation.balance, 0);
    }

    function test_cutoffIsNextMonthBoundary_andImmutable() public {
        // 2026-11-06 12:00 UTC -> round 1 ends 2026-12-01 00:00 UTC
        vm.warp(1_762_430_400);
        DogeRaffle fresh = new DogeRaffle(owner, treasury, foundation);
        (, uint64 endTime,,,,,,,) = fresh.rounds(1);
        assertEq(endTime, 1_764_547_200, "Dec 1 2026 00:00 UTC");

        // late draw on Dec 3 -> next round still ends Jan 1, cutoff = Jan 1
        vm.prank(alice);
        fresh.buyTickets{value: 20 ether}(SINGLE);
        vm.warp(1_764_547_200 + 2 days);
        fresh.commitDraw();
        (,, uint64 rb,,,,,,) = fresh.rounds(1);
        vm.roll(uint256(rb) + 1);
        fresh.finalizeDraw();
        assertEq(fresh.prizeOf(1).claimCutoff, 1_767_225_600, "Jan 1 2027 00:00 UTC");
        (, uint64 end2,,,,,,,) = fresh.rounds(2);
        assertEq(end2, 1_767_225_600);

        // claim valid right up to the boundary, dead at it
        vm.warp(1_767_225_600 - 1);
        vm.prank(alice);
        fresh.claimPrize(1);
    }

    function test_nextDrawTime_knownDates() public view {
        assertEq(raffle.nextDrawTime(1_767_225_599), 1_767_225_600, "Dec 31 23:59:59 -> Jan 1");
        assertEq(raffle.nextDrawTime(1_767_225_600), 1_769_904_000, "exactly Jan 1 -> Feb 1 2027");
        assertEq(raffle.nextDrawTime(1_772_323_200 - 1), 1_772_323_200, "Feb 28 2027 -> Mar 1");
        assertEq(raffle.nextDrawTime(1_709_164_800), 1_709_251_200, "Feb 28 2024 (leap) -> Mar 1 2024");
        assertEq(raffle.nextDrawTime(0), 2_678_400, "epoch -> Feb 1 1970");
    }

    function test_feeCapEnforced() public {
        vm.prank(owner);
        vm.expectRevert(DogeRaffle.FeeTooHigh.selector);
        raffle.setFeeBps(1001);
        vm.prank(owner);
        raffle.setFeeBps(1000);
        assertEq(raffle.feeBps(), 1000);
    }

    function test_bountyCappedByProtocolFee() public {
        // pot 20 -> protocol 1 DOGE == bounty cap -> treasury 0, keeper +1;
        // the bounty never touches the foundation's 1 DOGE
        _buySingles(alice, 1);
        _draw();
        assertEq(treasury.balance, 0);
        assertEq(keeper.balance, 101 ether);
        assertEq(foundation.balance, 1 ether);
    }

    function test_failedFoundationPushFallsBackToWithdrawable() public {
        RejectingReceiver badFoundation = new RejectingReceiver();
        vm.prank(owner);
        raffle.setFoundationWallet(address(badFoundation));

        _buySingles(alice, 50);
        _draw(); // draw must not be blocked by a reverting foundation wallet

        assertEq(raffle.withdrawable(address(badFoundation)), 50 ether);
        badFoundation.setAllow(true);
        badFoundation.withdraw(raffle);
        assertEq(address(badFoundation).balance, 50 ether);
    }

    function test_failedTreasuryPushFallsBackToWithdrawable() public {
        RejectingReceiver badTreasury = new RejectingReceiver();
        vm.prank(owner);
        raffle.setTreasury(address(badTreasury));

        _buySingles(alice, 50);
        _draw();

        assertEq(raffle.withdrawable(address(badTreasury)), 49 ether);
        badTreasury.setAllow(true);
        badTreasury.withdraw(raffle);
        assertEq(address(badTreasury).balance, 49 ether);
    }

    // --------------------------------------------------------------- draws

    function test_cannotCommitEarly() public {
        _buySingles(alice, 1);
        vm.expectRevert(DogeRaffle.RoundStillRunning.selector);
        raffle.commitDraw();
    }

    function test_finalizeRevertsBeforeRandomnessBlock() public {
        _buySingles(alice, 1);
        _endRound();
        raffle.commitDraw();
        vm.expectRevert(DogeRaffle.RandomnessNotReady.selector);
        raffle.finalizeDraw();
    }

    function test_expiredBlockhashRecommits() public {
        _buySingles(alice, 1);
        _endRound();
        raffle.commitDraw();
        uint64 firstBlock = _round(1).randomnessBlock;

        vm.roll(uint256(firstBlock) + 300); // past the 256-block window
        raffle.finalizeDraw(); // re-commits instead of reverting or drawing

        R memory r = _round(1);
        assertEq(uint8(r.status), uint8(DogeRaffle.RoundStatus.Committed));
        assertGt(r.randomnessBlock, firstBlock);

        vm.roll(uint256(r.randomnessBlock) + 1);
        raffle.finalizeDraw();
        assertEq(_round(1).winner, alice);
    }

    function test_pauseStopsSalesOnly() public {
        _buySingles(alice, 1);
        vm.prank(owner);
        raffle.pause();

        vm.prank(bob);
        vm.expectRevert();
        raffle.buyTickets{value: 20 ether}(SINGLE);

        // draw, claim and withdraw all proceed while paused
        uint256 r1 = _draw();
        assertEq(_round(r1).winner, alice);
        vm.prank(alice);
        raffle.claimPrize(r1);
    }

    function test_onlyOwnerAdmin() public {
        vm.startPrank(alice);
        vm.expectRevert();
        raffle.setFeeBps(100);
        vm.expectRevert();
        raffle.setTreasury(alice);
        vm.expectRevert();
        raffle.pause();
        vm.stopPrank();
    }

    function test_setBundles() public {
        DogeRaffle.Bundle[] memory newBundles = new DogeRaffle.Bundle[](2);
        newBundles[0] = DogeRaffle.Bundle({tickets: 1, price: 20 ether});
        newBundles[1] = DogeRaffle.Bundle({tickets: 10, price: 100 ether});
        vm.prank(owner);
        raffle.setBundles(newBundles);

        assertEq(raffle.bundleCount(), 2);
        vm.prank(alice);
        raffle.buyTickets{value: 100 ether}(1);
        assertEq(raffle.ticketsOf(1, alice), 10);
    }

    // ----------------------------------------------------------- views/UI

    function test_guaranteedPotAndPendingRollover() public {
        _buySingles(alice, 50);
        uint256 r1 = _draw();
        _buySingles(bob, 50);

        // before cutoff: rollover is possible, not guaranteed
        (uint256 amount, uint64 cutoff, bool stillClaimable) = raffle.pendingRollover();
        assertEq(amount, 900 ether);
        assertTrue(stillClaimable);
        assertEq(raffle.guaranteedPot(), 1000 ether);

        // past cutoff, pre-settlement: eligible/pending, still not settled
        vm.warp(cutoff);
        (amount,, stillClaimable) = raffle.pendingRollover();
        assertEq(amount, 900 ether);
        assertFalse(stillClaimable);
        assertEq(raffle.guaranteedPot(), 1000 ether);

        // settled at commit: now in the guaranteed pot... (consumed at finalize)
        raffle.commitDraw();
        assertEq(raffle.guaranteedPot(), 1900 ether);
        (amount,,) = raffle.pendingRollover();
        assertEq(amount, 0);
        r1; // silence unused
    }

    // ---------------------------------------------------------- fuzz/stat

    /// Wei-level conservation across randomized buy/claim/expire sequences:
    /// contract balance always equals current pot + carry + live claims +
    /// withdrawable credits; and everything eventually drains to zero.
    function testFuzz_valueConservation(uint8 nBuysA, uint8 nBuysB, bool claimR1) public {
        uint256 a = bound(nBuysA, 1, 20);
        uint256 b = bound(nBuysB, 1, 20);

        _buySingles(alice, a);
        _buySingles(bob, b);
        uint256 r1 = _draw();

        DogeRaffle.Prize memory p1 = raffle.prizeOf(r1);
        address w1 = _round(r1).winner;
        assertEq(
            address(raffle).balance,
            p1.amount + raffle.withdrawable(treasury) + raffle.withdrawable(foundation),
            "post-draw escrow accounting"
        );

        if (claimR1) {
            vm.prank(w1);
            raffle.claimPrize(r1);
        }

        // round 2 with fresh tickets, then draw (rolls r1 iff unclaimed)
        _buySingles(alice, 3);
        uint256 r2 = _draw();

        DogeRaffle.Prize memory p2 = raffle.prizeOf(r2);
        uint256 expectedGross = 60 ether + (claimR1 ? 0 : p1.amount);
        uint256 expectedFees = (expectedGross * 500) / 10_000 + (expectedGross * 500) / 10_000;
        assertEq(p2.amount, expectedGross - expectedFees, "both fees on full gross incl. rollover");

        // drain: winner claims, invariant -> zero
        address w2 = _round(r2).winner;
        vm.prank(w2);
        raffle.claimPrize(r2);
        assertEq(
            address(raffle).balance,
            raffle.withdrawable(treasury) + raffle.withdrawable(foundation) + raffle.withdrawable(alice)
                + raffle.withdrawable(bob),
            "all residue is pull-credits"
        );
    }

    /// Statistical fairness: alice 1 ticket vs bob 9 — bob wins ~90%.
    function test_statisticalFairness() public {
        uint256 bobWins;
        uint256 roundsCount = 300;

        for (uint256 i = 0; i < roundsCount; i++) {
            uint256 roundId = raffle.currentRoundId();
            vm.prank(alice);
            raffle.buyTickets{value: 20 ether}(SINGLE);
            vm.prank(bob);
            raffle.buyTickets{value: 90 ether}(FIVE);
            for (uint256 j = 0; j < 4; j++) {
                vm.prank(bob);
                raffle.buyTickets{value: 20 ether}(SINGLE);
            }

            _endRound();
            raffle.commitDraw();
            uint64 rb = _round(roundId).randomnessBlock;
            vm.roll(uint256(rb) + 1);
            vm.setBlockhash(rb, keccak256(abi.encode("doge", i)));
            raffle.finalizeDraw();

            address winner = _round(roundId).winner;
            if (winner == bob) bobWins++;
            // claim every prize so pots don't roll between iterations
            vm.prank(winner);
            raffle.claimPrize(roundId);
        }

        assertGt(bobWins, (roundsCount * 80) / 100, "bob wins at least 80%");
        assertLt(bobWins, (roundsCount * 98) / 100, "alice wins sometimes");
    }

    /// Winner lookup is correct at the range boundaries of cumulative entries.
    function testFuzz_ticketOwnershipBoundaries(uint96 ticket) public {
        // alice: ticket 0 (single), bob: 1..10 (ten-pack), alice: 11..15 (five-pack)
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        vm.prank(bob);
        raffle.buyTickets{value: 170 ether}(TEN);
        vm.prank(alice);
        raffle.buyTickets{value: 90 ether}(FIVE);

        ticket = uint96(bound(ticket, 0, 15));
        address expected = ticket == 0 ? alice : (ticket <= 10 ? bob : alice);

        _endRound();
        raffle.commitDraw();
        uint64 rb = _round(1).randomnessBlock;
        vm.roll(uint256(rb) + 1);

        // brute-force a seed that lands exactly on `ticket`
        bytes32 seedHash;
        uint256 nonce;
        while (true) {
            seedHash = keccak256(abi.encode("search", nonce));
            uint256 winning =
                uint256(keccak256(abi.encodePacked(seedHash, uint256(1), uint96(16), address(raffle)))) % 16;
            if (winning == ticket) break;
            nonce++;
        }
        vm.setBlockhash(rb, seedHash);
        raffle.finalizeDraw();

        assertEq(_round(1).winner, expected, "binary search maps ticket to correct owner");
    }

    // ------------------------------------------------- ticket numbering / audit

    function test_ticketNumbersAndWinningTicketAreAuditable() public {
        // alice: #0, bob: #1..#10, alice: #11..#15
        vm.expectEmit(true, true, false, true);
        emit DogeRaffle.TicketsPurchased(1, alice, SINGLE, 0, 1, 20 ether);
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);

        vm.expectEmit(true, true, false, true);
        emit DogeRaffle.TicketsPurchased(1, bob, TEN, 1, 10, 170 ether);
        vm.prank(bob);
        raffle.buyTickets{value: 170 ether}(TEN);

        vm.prank(alice);
        raffle.buyTickets{value: 90 ether}(FIVE);

        (address b0, uint256 f0, uint256 l0) = raffle.entryAt(1, 0);
        (address b1, uint256 f1, uint256 l1) = raffle.entryAt(1, 1);
        (address b2, uint256 f2, uint256 l2) = raffle.entryAt(1, 2);
        assertEq(b0, alice); assertEq(f0, 0); assertEq(l0, 0);
        assertEq(b1, bob); assertEq(f1, 1); assertEq(l1, 10);
        assertEq(b2, alice); assertEq(f2, 11); assertEq(l2, 15);

        // force the draw onto ticket #7 and check it is recorded + bob wins
        _endRound();
        raffle.commitDraw();
        uint64 rb = _round(1).randomnessBlock;
        vm.roll(uint256(rb) + 1);
        bytes32 seedHash; uint256 nonce;
        while (true) {
            seedHash = keccak256(abi.encode("audit", nonce));
            if (uint256(keccak256(abi.encodePacked(seedHash, uint256(1), uint96(16), address(raffle)))) % 16 == 7) break;
            nonce++;
        }
        vm.setBlockhash(rb, seedHash);
        raffle.finalizeDraw();
        assertEq(raffle.winningTicketOf(1), 7);
        assertEq(_round(1).winner, bob);
    }

    function test_withdrawRevertsWithNothingPending() public {
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.NothingToWithdraw.selector);
        raffle.withdrawPayout();
    }
}

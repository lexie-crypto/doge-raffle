// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";

/// Recipient that rejects native transfers — used to prove the pull fallback.
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

    function withdraw(DogeRaffle raffle) external {
        raffle.withdrawPayout();
    }
}

/// Buyer that attempts to re-enter buyTickets from its receive hook.
contract ReentrantBuyer {
    DogeRaffle private immutable raffle;
    bool public reentered;

    constructor(DogeRaffle raffle_) {
        raffle = raffle_;
    }

    function buy(uint256 bundleId) external payable {
        raffle.buyTickets{value: msg.value}(bundleId);
    }

    receive() external payable {
        // try to re-enter during the prize push
        (bool ok,) = address(raffle).call{value: 0}(abi.encodeCall(DogeRaffle.withdrawPayout, ()));
        reentered = ok;
    }
}

contract DogeRaffleTest is Test {
    DogeRaffle internal raffle;
    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    uint256 internal constant SINGLE = 0; // 1 ticket / 20 DOGE
    uint256 internal constant FIVE = 1; // 5 tickets / 90 DOGE
    uint256 internal constant TEN = 2; // 10 tickets / 170 DOGE

    function setUp() public {
        raffle = new DogeRaffle(owner, treasury);
        vm.deal(alice, 1_000_000 ether);
        vm.deal(bob, 1_000_000 ether);
        vm.deal(keeper, 10 ether);
    }

    // ------------------------------------------------------------ helpers

    function _endRound() internal {
        (, DogeRaffle.Round memory round,) = raffle.currentRound();
        vm.warp(round.endTime);
    }

    /// Full happy-path draw: commit, roll past the randomness block, finalize.
    function _draw() internal {
        vm.prank(keeper);
        raffle.commitDraw();
        (,, uint64 randomnessBlock,,,,,) = raffle.rounds(_lastCommittedRound());
        vm.roll(uint256(randomnessBlock) + 1);
        vm.prank(keeper);
        raffle.finalizeDraw();
    }

    function _lastCommittedRound() internal view returns (uint256) {
        return raffle.currentRoundId();
    }

    // ------------------------------------------------------------- buying

    function test_buySingleBundle() public {
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);

        assertEq(raffle.ticketsOf(1, alice), 1);
        (, DogeRaffle.Round memory round,) = raffle.currentRound();
        assertEq(round.totalTickets, 1);
        assertEq(round.pot, 20 ether);
        assertEq(address(raffle).balance, 20 ether);
    }

    function test_buyAllBundleTiers() public {
        vm.startPrank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        raffle.buyTickets{value: 90 ether}(FIVE);
        raffle.buyTickets{value: 170 ether}(TEN);
        vm.stopPrank();

        assertEq(raffle.ticketsOf(1, alice), 16);
        (, DogeRaffle.Round memory round,) = raffle.currentRound();
        assertEq(round.pot, 280 ether);
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

    // --------------------------------------------------------------- draws

    function test_cannotCommitEarly() public {
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        vm.expectRevert(DogeRaffle.RoundStillRunning.selector);
        raffle.commitDraw();
    }

    function test_fullDraw_feeAndPrizeMath() public {
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        vm.prank(bob);
        raffle.buyTickets{value: 170 ether}(TEN);

        uint256 pot = 190 ether;
        uint256 fee = (pot * 500) / 10_000; // 9.5 DOGE
        uint256 prize = pot - fee;
        uint256 bounty = 1 ether;

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        uint256 keeperBefore = keeper.balance;

        _endRound();
        _draw();

        (,,,,,, address winner, uint256 recordedPrize) = raffle.rounds(1);
        assertTrue(winner == alice || winner == bob, "winner is a participant");
        assertEq(recordedPrize, prize);

        // exact conservation: winner got prize, treasury fee-bounty, keeper bounty
        assertEq(treasury.balance, fee - bounty);
        assertEq(keeper.balance, keeperBefore + bounty);
        uint256 winnerGain = winner == alice ? alice.balance - aliceBefore : bob.balance - bobBefore;
        assertEq(winnerGain, prize);
        assertEq(address(raffle).balance, 0, "contract fully drained");

        // next round auto-opened
        assertEq(raffle.currentRoundId(), 2);
        (, DogeRaffle.Round memory next,) = raffle.currentRound();
        assertEq(uint8(next.status), uint8(DogeRaffle.RoundStatus.Open));
    }

    function test_finalizeRevertsBeforeRandomnessBlock() public {
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        _endRound();
        raffle.commitDraw();
        vm.expectRevert(DogeRaffle.RandomnessNotReady.selector);
        raffle.finalizeDraw();
    }

    function test_emptyRoundRollsOver() public {
        _endRound();
        raffle.commitDraw();
        assertEq(raffle.currentRoundId(), 2);
        assertEq(treasury.balance, 0, "no fee on empty round");
        (, DogeRaffle.Round memory round,) = raffle.currentRound();
        assertEq(uint8(round.status), uint8(DogeRaffle.RoundStatus.Open));
    }

    function test_expiredBlockhashRecommits() public {
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        _endRound();
        raffle.commitDraw();
        (,, uint64 firstBlock,,,,,) = raffle.rounds(1);

        // jump far past the 256-block hash window
        vm.roll(uint256(firstBlock) + 300);
        raffle.finalizeDraw(); // should re-commit, not revert or draw

        (,, uint64 secondBlock,, DogeRaffle.RoundStatus status,,,) = _roundFields(1);
        assertEq(uint8(status), uint8(DogeRaffle.RoundStatus.Committed), "still committed");
        assertGt(secondBlock, firstBlock, "randomness block re-pinned");

        // now finalize for real
        vm.roll(uint256(secondBlock) + 1);
        raffle.finalizeDraw();
        (,,,,,, address winner,) = raffle.rounds(1);
        assertEq(winner, alice);
    }

    function _roundFields(uint256 id)
        internal
        view
        returns (
            uint64 startTime,
            uint64 endTime,
            uint64 randomnessBlock,
            uint96 totalTickets,
            DogeRaffle.RoundStatus status,
            uint256 pot,
            address winner,
            uint256 prize
        )
    {
        (startTime, endTime, randomnessBlock, status, totalTickets, pot, winner, prize) = raffle.rounds(id);
    }

    // ------------------------------------------------- payout fail-safety

    function test_rejectingWinnerGetsCredited_thenWithdraws() public {
        RejectingReceiver rejector = new RejectingReceiver();
        vm.deal(address(this), 20 ether);
        rejector.buy{value: 20 ether}(raffle, SINGLE);

        _endRound();
        _draw();

        // sole participant must have won; push failed -> credited
        uint256 prize = 20 ether - (20 ether * 500) / 10_000;
        assertEq(raffle.withdrawable(address(rejector)), prize);
        assertEq(address(raffle).balance, prize, "prize escrowed, not lost");

        // draw was NOT blocked: next round is open
        assertEq(raffle.currentRoundId(), 2);

        rejector.setAllow(true);
        rejector.withdraw(raffle);
        assertEq(address(rejector).balance, prize);
        assertEq(raffle.withdrawable(address(rejector)), 0);
    }

    function test_withdrawRevertsWithNothingPending() public {
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.NothingToWithdraw.selector);
        raffle.withdrawPayout();
    }

    function test_reentrancyDuringPrizePushIsHarmless() public {
        ReentrantBuyer attacker = new ReentrantBuyer(raffle);
        vm.deal(address(this), 20 ether);
        attacker.buy{value: 20 ether}(SINGLE == 0 ? 0 : 0);

        _endRound();
        _draw();

        // re-entrant call during receive() must have failed (nonReentrant)
        assertFalse(attacker.reentered(), "re-entry blocked");
        // prize still delivered (push succeeded; receive didn't revert)
        uint256 prize = 20 ether - (20 ether * 500) / 10_000;
        assertEq(address(attacker).balance, prize);
    }

    // --------------------------------------------------------------- admin

    function test_pauseStopsSalesOnly() public {
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);

        vm.prank(owner);
        raffle.pause();

        vm.prank(bob);
        vm.expectRevert(); // Pausable: EnforcedPause
        raffle.buyTickets{value: 20 ether}(SINGLE);

        // draw proceeds while paused — funds can never be trapped
        _endRound();
        _draw();
        (,,,,,, address winner,) = raffle.rounds(1);
        assertEq(winner, alice);
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

    function test_feeCapEnforced() public {
        vm.prank(owner);
        vm.expectRevert(DogeRaffle.FeeTooHigh.selector);
        raffle.setFeeBps(1001);
        vm.prank(owner);
        raffle.setFeeBps(1000); // exactly the cap is fine
        assertEq(raffle.feeBps(), 1000);
    }

    function test_setBundles() public {
        DogeRaffle.Bundle[] memory newBundles = new DogeRaffle.Bundle[](2);
        newBundles[0] = DogeRaffle.Bundle({tickets: 1, price: 20 ether});
        newBundles[1] = DogeRaffle.Bundle({tickets: 10, price: 100 ether}); // user's original pricing
        vm.prank(owner);
        raffle.setBundles(newBundles);

        assertEq(raffle.bundleCount(), 2);
        vm.prank(alice);
        raffle.buyTickets{value: 100 ether}(1);
        assertEq(raffle.ticketsOf(1, alice), 10);
    }

    function test_bountyCappedByFee() public {
        // tiny pot: fee (5% of 20 = 1 DOGE) == bounty (1 DOGE) -> treasury gets 0, keeper gets fee
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        _endRound();
        _draw();
        assertEq(treasury.balance, 0);
        assertEq(keeper.balance, 10 ether + 1 ether); // initial 10 + bounty
    }

    // ---------------------------------------------------------- fuzz/stat

    /// Any purchase sequence conserves value exactly: prize + fee == pot.
    function testFuzz_valueConservation(uint8 nBuys, uint256 seed) public {
        nBuys = uint8(bound(nBuys, 1, 40));
        uint256 pot;
        for (uint256 i = 0; i < nBuys; i++) {
            uint256 bundleId = uint256(keccak256(abi.encode(seed, i))) % 3;
            address buyer = i % 2 == 0 ? alice : bob;
            (, uint224 price) = raffle.bundles(bundleId);
            vm.prank(buyer);
            raffle.buyTickets{value: price}(bundleId);
            pot += price;
        }

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        _endRound();
        _draw();

        uint256 fee = (pot * 500) / 10_000;
        uint256 paidOut = (alice.balance - aliceBefore) + (bob.balance - bobBefore) + treasury.balance
            + raffle.withdrawable(alice) + raffle.withdrawable(bob);
        // keeper bounty came out of fee; add it back
        paidOut += 1 ether; // bounty (fee >= 1 DOGE whenever pot >= 20 DOGE)
        assertEq(paidOut, pot, "every wei of the pot accounted for");
        assertEq(address(raffle).balance, 0);
        // sanity: fee split correct
        assertEq(treasury.balance, fee - 1 ether);
    }

    /// Statistical fairness: with alice holding 1 ticket and bob 9, bob should
    /// win ~90% of draws across many independent rounds.
    function test_statisticalFairness() public {
        uint256 bobWins;
        uint256 rounds = 300;

        for (uint256 i = 0; i < rounds; i++) {
            uint256 roundId = raffle.currentRoundId();
            vm.prank(alice);
            raffle.buyTickets{value: 20 ether}(SINGLE);
            vm.prank(bob);
            // 9 tickets: 5-pack + 4 singles — exercises multi-entry search too
            raffle.buyTickets{value: 90 ether}(FIVE);
            for (uint256 j = 0; j < 4; j++) {
                vm.prank(bob);
                raffle.buyTickets{value: 20 ether}(SINGLE);
            }

            _endRound();
            raffle.commitDraw();
            (,, uint64 randomnessBlock,,,,,) = raffle.rounds(roundId);
            vm.roll(uint256(randomnessBlock) + 1);
            // vary the blockhash seed per round
            vm.setBlockhash(randomnessBlock, keccak256(abi.encode("doge", i)));
            raffle.finalizeDraw();

            (,,,,,, address winner,) = raffle.rounds(roundId);
            if (winner == bob) bobWins++;
        }

        // expected 90%; allow generous tolerance for 300 samples (~±5 sigma)
        assertGt(bobWins, (rounds * 80) / 100, "bob wins at least 80%");
        assertLt(bobWins, (rounds * 98) / 100, "alice wins sometimes");
    }

    /// Winner lookup is correct at the range boundaries of cumulative entries.
    function testFuzz_ticketOwnershipBoundaries(uint96 ticket) public {
        // alice: tickets 0..0 (single), bob: 1..10 (ten-pack), alice: 11..15 (five-pack)
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(SINGLE);
        vm.prank(bob);
        raffle.buyTickets{value: 170 ether}(TEN);
        vm.prank(alice);
        raffle.buyTickets{value: 90 ether}(FIVE);

        ticket = uint96(bound(ticket, 0, 15));
        address expected = ticket == 0 ? alice : (ticket <= 10 ? bob : alice);

        // drive the draw to land exactly on `ticket` by brute-forcing a seed
        _endRound();
        raffle.commitDraw();
        (,, uint64 randomnessBlock,,,,,) = raffle.rounds(1);
        vm.roll(uint256(randomnessBlock) + 1);

        bytes32 seedHash;
        uint256 nonce;
        while (true) {
            seedHash = keccak256(abi.encode("search", nonce));
            uint256 winning =
                uint256(keccak256(abi.encodePacked(seedHash, uint256(1), uint96(16), address(raffle)))) % 16;
            if (winning == ticket) break;
            nonce++;
        }
        vm.setBlockhash(randomnessBlock, seedHash);
        raffle.finalizeDraw();

        (,,,,,, address winner,) = raffle.rounds(1);
        assertEq(winner, expected, "binary search maps ticket to correct owner");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";
import {DogeVRFCoordinator} from "../src/vrf/DogeVRFCoordinator.sol";
import {VRF} from "../src/vrf/vendor/VRF.sol";

/// Minimal coordinator stand-in for unit tests: records requests, lets the
/// test deliver (or withhold) a callback.
contract MockCoordinator {
    uint256 public lastRequestId;
    mapping(uint256 => address) public consumerOf;

    function requestRandomness(bytes32) external payable returns (uint256 requestId) {
        requestId = ++lastRequestId;
        consumerOf[requestId] = msg.sender;
    }

    function deliver(uint256 requestId, uint256 randomness) external {
        DogeRaffle(payable(consumerOf[requestId])).rawFulfillRandomness(requestId, randomness);
    }
}

contract DogeRaffleVRFTest is Test {
    uint256 internal constant ORACLE_SK = 0x1111111111111111111111111111111111111111111111111111111111111111;

    DogeRaffle internal raffle;
    MockCoordinator internal mock;
    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        raffle = new DogeRaffle(owner, treasury);
        mock = new MockCoordinator();
        vm.prank(owner);
        raffle.setVrfCoordinator(address(mock));
        vm.deal(alice, 1_000_000 ether);
        vm.deal(keeper, 100 ether);
    }

    function _roundEnd() internal view returns (uint64 endTime) {
        (, endTime,,,,,,) = raffle.rounds(raffle.currentRoundId());
    }

    function _buyAndCommit() internal returns (uint256 roundId) {
        roundId = raffle.currentRoundId();
        vm.prank(alice);
        raffle.buyTickets{value: 20 ether}(0);
        vm.warp(_roundEnd());
        vm.prank(keeper);
        raffle.commitDraw();
    }

    // ------------------------------------------------------------ VRF path

    function test_commitRequestsVrf() public {
        uint256 roundId = _buyAndCommit();
        assertEq(raffle.vrfRequestOf(roundId), 1);
        assertEq(raffle.roundOfRequest(1), roundId);
    }

    function test_vrfCallbackSettlesDraw_noBounty() public {
        uint256 roundId = _buyAndCommit();
        mock.deliver(1, 424242);

        (,,,,,,, address winner) = raffle.rounds(roundId);
        assertEq(winner, alice);
        DogeRaffle.Prize memory prize = raffle.prizeOf(roundId);
        assertEq(prize.amount, 19 ether); // 20 - 5%
        // full fee to treasury: no bounty on the VRF path
        assertEq(treasury.balance, 1 ether);
        assertEq(raffle.currentRoundId(), roundId + 1);

        // winner claims as usual
        vm.prank(alice);
        raffle.claimPrize(roundId);
        assertEq(address(raffle).balance, 0);
    }

    function test_onlyCoordinatorCanFulfill() public {
        _buyAndCommit();
        vm.prank(alice);
        vm.expectRevert(DogeRaffle.OnlyCoordinator.selector);
        raffle.rawFulfillRandomness(1, 1);
    }

    function test_fallbackBlockedBeforeTimeout() public {
        uint256 roundId = _buyAndCommit();
        (,, uint64 rb,,,,,) = raffle.rounds(roundId);
        vm.roll(uint256(rb) + 1);
        assertFalse(raffle.canFinalize());
        vm.prank(keeper);
        vm.expectRevert(DogeRaffle.VrfStillPending.selector);
        raffle.finalizeDraw();
    }

    function test_fallbackSettlesAfterTimeout_withBounty() public {
        uint256 roundId = _buyAndCommit();
        (,, uint64 rb,,,,,) = raffle.rounds(roundId);
        vm.roll(uint256(rb) + 1);
        vm.warp(block.timestamp + raffle.vrfTimeout());
        assertTrue(raffle.canFinalize());

        vm.prank(keeper);
        raffle.finalizeDraw();
        (,,,,,,, address winner) = raffle.rounds(roundId);
        assertEq(winner, alice);
        // bounty paid on the fallback path (fee 1 == bounty cap)
        assertEq(keeper.balance, 101 ether);

        // late VRF response is now rejected (and the coordinator would
        // swallow this revert in its best-effort callback)
        vm.expectRevert(DogeRaffle.StaleVrfResponse.selector);
        mock.deliver(1, 999);
    }

    function test_vrfAfterFallback_cannotDoubleSettle() public {
        uint256 roundId = _buyAndCommit();
        (,, uint64 rb,,,,,) = raffle.rounds(roundId);
        vm.roll(uint256(rb) + 1);
        vm.warp(block.timestamp + raffle.vrfTimeout());
        vm.prank(keeper);
        raffle.finalizeDraw();

        uint256 escrow = raffle.prizeOf(roundId).amount;
        vm.expectRevert(DogeRaffle.StaleVrfResponse.selector);
        mock.deliver(1, 123);
        assertEq(raffle.prizeOf(roundId).amount, escrow, "settlement immutable");
    }

    function test_staleResponseForOldRoundRejected() public {
        uint256 r1 = _buyAndCommit();
        mock.deliver(1, 7); // settles r1, opens r2
        assertEq(raffle.currentRoundId(), r1 + 1);
        // replaying r1's request id must fail
        vm.expectRevert(DogeRaffle.StaleVrfResponse.selector);
        mock.deliver(1, 8);
    }

    function test_disablingCoordinatorRestoresBlockhashMode() public {
        vm.prank(owner);
        raffle.setVrfCoordinator(address(0));
        uint256 roundId = _buyAndCommit();
        assertEq(raffle.vrfRequestOf(roundId), 0);
        (,, uint64 rb,,,,,) = raffle.rounds(roundId);
        vm.roll(uint256(rb) + 1);
        // no timeout gate without a request
        vm.prank(keeper);
        raffle.finalizeDraw();
        (,,,,,,, address winner) = raffle.rounds(roundId);
        assertEq(winner, alice);
    }

    function test_timeoutFloorEnforced() public {
        vm.prank(owner);
        vm.expectRevert(DogeRaffle.TimeoutTooShort.selector);
        raffle.setVrfTimeout(9 minutes);
    }

    // ------------------------------------- full end-to-end with real proofs

    function test_endToEnd_realCoordinator_realProof() public {
        // real coordinator with the ffi oracle key
        uint256[2] memory pk = _ffiPubkey(ORACLE_SK);
        vm.prank(owner);
        DogeVRFCoordinator coordinator = new DogeVRFCoordinator(owner, pk);
        vm.startPrank(owner);
        coordinator.setFeeExempt(address(raffle), true);
        raffle.setVrfCoordinator(address(coordinator));
        vm.stopPrank();

        // buy + commit -> raffle requests randomness
        uint256 roundId = _buyAndCommit();
        uint256 requestId = raffle.vrfRequestOf(roundId);
        (,,, uint256 seed) = coordinator.pendingRequest(requestId);

        // oracle proves off-chain, fulfills on-chain; callback settles draw
        VRF.Proof memory proof = _ffiProve(ORACLE_SK, seed);
        coordinator.fulfill(proof, requestId);

        (,,,,,,, address winner) = raffle.rounds(roundId);
        assertEq(winner, alice);
        assertEq(raffle.prizeOf(roundId).amount, 19 ether);
        assertEq(raffle.currentRoundId(), roundId + 1);

        // randomness matches the VRF output rule
        assertEq(coordinator.responses(requestId), uint256(keccak256(abi.encode(uint256(3), proof.gamma))));

        vm.prank(alice);
        raffle.claimPrize(roundId);
        assertEq(address(raffle).balance, 0);
    }

    // ---------------------------------------------------------- ffi helpers

    function _ffiPubkey(uint256 sk) internal returns (uint256[2] memory pk) {
        string[] memory cmd = new string[](4);
        cmd[0] = "node";
        cmd[1] = "../bot/ecvrf-cli.mjs";
        cmd[2] = "pubkey";
        cmd[3] = vm.toString(bytes32(sk));
        (pk[0], pk[1]) = abi.decode(vm.ffi(cmd), (uint256, uint256));
    }

    function _ffiProve(uint256 sk, uint256 seed) internal returns (VRF.Proof memory proof) {
        string[] memory cmd = new string[](5);
        cmd[0] = "node";
        cmd[1] = "../bot/ecvrf-cli.mjs";
        cmd[2] = "prove";
        cmd[3] = vm.toString(bytes32(sk));
        cmd[4] = vm.toString(bytes32(seed));
        proof = abi.decode(vm.ffi(cmd), (VRF.Proof));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {VRF} from "../src/vrf/vendor/VRF.sol";
import {DogeVRFCoordinator} from "../src/vrf/DogeVRFCoordinator.sol";
import {IVRFConsumer} from "../src/vrf/IVRFConsumer.sol";

contract MockConsumer is IVRFConsumer {
    DogeVRFCoordinator public immutable coordinator;
    uint256 public lastRequestId;
    uint256 public lastRandomness;
    bool public revertOnCallback;

    constructor(DogeVRFCoordinator coordinator_) {
        coordinator = coordinator_;
    }

    function request(bytes32 userSeed) external payable returns (uint256) {
        return coordinator.requestRandomness{value: msg.value}(userSeed);
    }

    function setRevert(bool v) external {
        revertOnCallback = v;
    }

    function rawFulfillRandomness(uint256 requestId, uint256 randomness) external {
        require(msg.sender == address(coordinator), "only coordinator");
        require(!revertOnCallback, "consumer revert");
        lastRequestId = requestId;
        lastRandomness = randomness;
    }
}

contract DogeVRFCoordinatorTest is Test {
    // Test-only oracle secret key (NEVER use outside tests).
    uint256 internal constant ORACLE_SK = 0x1111111111111111111111111111111111111111111111111111111111111111;

    DogeVRFCoordinator internal coordinator;
    MockConsumer internal consumer;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    function setUp() public {
        uint256[2] memory pk = _ffiPubkey(ORACLE_SK);
        vm.prank(owner);
        coordinator = new DogeVRFCoordinator(owner, pk);
        consumer = new MockConsumer(coordinator);
        vm.deal(alice, 100 ether);
        vm.deal(address(this), 100 ether);
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

    function _requestSeed(uint256 requestId) internal view returns (uint256) {
        (,,, uint256 seed) = coordinator.pendingRequest(requestId);
        return seed;
    }

    // ------------------------------------------------------- request + fee

    function test_requestChargesFee() public {
        vm.prank(alice);
        uint256 id = coordinator.requestRandomness{value: 2 ether}(bytes32("hi"));
        assertEq(id, 1);
        assertEq(coordinator.accruedFees(), 2 ether);
        (address c,, bool fulfilled,) = coordinator.pendingRequest(id);
        assertEq(c, alice);
        assertFalse(fulfilled);
    }

    function test_wrongFeeReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DogeVRFCoordinator.WrongFee.selector, 2 ether, 1 ether));
        coordinator.requestRandomness{value: 1 ether}(bytes32("hi"));
    }

    function test_feeExemptPaysNothing() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request{value: 0}(bytes32("free"));
        assertEq(coordinator.accruedFees(), 0);
        assertEq(id, 1);

        // exempt consumer must not overpay either
        vm.expectRevert(abi.encodeWithSelector(DogeVRFCoordinator.WrongFee.selector, 0, 2 ether));
        consumer.request{value: 2 ether}(bytes32("free"));
    }

    function test_withdrawFees() public {
        vm.prank(alice);
        coordinator.requestRandomness{value: 2 ether}(bytes32("hi"));
        address sink = makeAddr("sink");
        vm.prank(owner);
        coordinator.withdrawFees(sink);
        assertEq(sink.balance, 2 ether);
        assertEq(coordinator.accruedFees(), 0);
    }

    // --------------------------------------------- fulfillment (real proofs)

    function test_fulfillWithRealProof_deliversCallback() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request(bytes32("round-1"));

        VRF.Proof memory proof = _ffiProve(ORACLE_SK, _requestSeed(id));
        coordinator.fulfill(proof, id);

        assertEq(consumer.lastRequestId(), id);
        uint256 expected = uint256(keccak256(abi.encode(uint256(3), proof.gamma)));
        assertEq(consumer.lastRandomness(), expected, "output = keccak(3, gamma)");
        assertEq(coordinator.responses(id), expected);
    }

    function test_fulfillTwiceReverts() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request(bytes32("x"));
        VRF.Proof memory proof = _ffiProve(ORACLE_SK, _requestSeed(id));
        coordinator.fulfill(proof, id);
        vm.expectRevert(DogeVRFCoordinator.AlreadyFulfilled.selector);
        coordinator.fulfill(proof, id);
    }

    function test_unknownRequestReverts() public {
        VRF.Proof memory proof = _ffiProve(ORACLE_SK, 123);
        vm.expectRevert(DogeVRFCoordinator.UnknownRequest.selector);
        coordinator.fulfill(proof, 99);
    }

    function test_wrongKeyProofRejected() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request(bytes32("x"));
        // proof from a DIFFERENT secret key: correct math, wrong identity
        VRF.Proof memory proof = _ffiProve(uint256(keccak256("other key")), _requestSeed(id));
        vm.expectRevert(DogeVRFCoordinator.WrongKey.selector);
        coordinator.fulfill(proof, id);
    }

    function test_wrongSeedProofRejected() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request(bytes32("x"));
        VRF.Proof memory proof = _ffiProve(ORACLE_SK, _requestSeed(id) + 1);
        vm.expectRevert(DogeVRFCoordinator.WrongSeed.selector);
        coordinator.fulfill(proof, id);
    }

    function test_tamperedProofRejected() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request(bytes32("x"));
        VRF.Proof memory proof = _ffiProve(ORACLE_SK, _requestSeed(id));
        // flip the gamma point to a different valid-looking value: the
        // oracle cannot substitute an output it likes better
        proof.gamma[0] ^= 1;
        vm.expectRevert(); // fails on-curve or proof check
        coordinator.fulfill(proof, id);
    }

    function test_revertingConsumer_outputStillStored() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request(bytes32("x"));
        consumer.setRevert(true);
        VRF.Proof memory proof = _ffiProve(ORACLE_SK, _requestSeed(id));
        coordinator.fulfill(proof, id); // must NOT revert
        assertEq(consumer.lastRandomness(), 0, "callback failed");
        assertGt(coordinator.responses(id), 0, "output stored for pull");
    }

    function test_outputsDifferAcrossRequests() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id1 = consumer.request(bytes32("same"));
        uint256 id2 = consumer.request(bytes32("same"));
        coordinator.fulfill(_ffiProve(ORACLE_SK, _requestSeed(id1)), id1);
        coordinator.fulfill(_ffiProve(ORACLE_SK, _requestSeed(id2)), id2);
        assertTrue(
            coordinator.responses(id1) != coordinator.responses(id2),
            "same user seed, distinct domain-separated outputs"
        );
    }

    // --------------------------------------------------------------- admin

    function test_keyRotation() public {
        vm.prank(owner);
        coordinator.setFeeExempt(address(consumer), true);
        uint256 id = consumer.request(bytes32("x"));

        uint256 newSk = uint256(keccak256("new oracle key")) % type(uint128).max;
        uint256[2] memory newPk = _ffiPubkey(newSk);
        vm.prank(owner);
        coordinator.setOracleKey(newPk);

        // old-key proof now rejected; new-key proof accepted (seed unchanged)
        VRF.Proof memory oldKeyProof = _ffiProve(ORACLE_SK, _requestSeed(id));
        VRF.Proof memory newKeyProof = _ffiProve(newSk, _requestSeed(id));
        vm.expectRevert(DogeVRFCoordinator.WrongKey.selector);
        coordinator.fulfill(oldKeyProof, id);
        coordinator.fulfill(newKeyProof, id);
        assertGt(coordinator.responses(id), 0);
    }

    function test_onlyOwnerAdmin() public {
        uint256[2] memory pk = _ffiPubkey(ORACLE_SK);
        vm.startPrank(alice);
        vm.expectRevert();
        coordinator.setOracleKey(pk);
        vm.expectRevert();
        coordinator.setRequestFee(1);
        vm.expectRevert();
        coordinator.setFeeExempt(alice, true);
        vm.expectRevert();
        coordinator.withdrawFees(alice);
        vm.stopPrank();
    }

    function test_badKeyRejected() public {
        uint256[2] memory badPk = [uint256(1), uint256(2)];
        vm.prank(owner);
        vm.expectRevert("key not on curve");
        coordinator.setOracleKey(badPk);
    }
}

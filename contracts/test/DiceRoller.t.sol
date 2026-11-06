// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {VRF} from "../src/vrf/vendor/VRF.sol";
import {DogeVRFCoordinator} from "../src/vrf/DogeVRFCoordinator.sol";
import {DiceRoller} from "../src/examples/DiceRoller.sol";

/// Proves the docs example works end-to-end with real proofs.
contract DiceRollerTest is Test {
    uint256 internal constant ORACLE_SK = 0x1111111111111111111111111111111111111111111111111111111111111111;
    DogeVRFCoordinator internal coordinator;
    DiceRoller internal dice;
    address internal owner = makeAddr("owner");
    address internal player = makeAddr("player");

    function setUp() public {
        string[] memory cmd = new string[](4);
        cmd[0] = "node";
        cmd[1] = "../bot/ecvrf-cli.mjs";
        cmd[2] = "pubkey";
        cmd[3] = vm.toString(bytes32(ORACLE_SK));
        uint256[2] memory pk;
        (pk[0], pk[1]) = abi.decode(vm.ffi(cmd), (uint256, uint256));
        coordinator = new DogeVRFCoordinator(owner, pk);
        dice = new DiceRoller(address(coordinator));
        vm.deal(player, 10 ether);
    }

    function _prove(uint256 seed) internal returns (VRF.Proof memory proof) {
        string[] memory cmd = new string[](5);
        cmd[0] = "node";
        cmd[1] = "../bot/ecvrf-cli.mjs";
        cmd[2] = "prove";
        cmd[3] = vm.toString(bytes32(ORACLE_SK));
        cmd[4] = vm.toString(bytes32(seed));
        proof = abi.decode(vm.ffi(cmd), (VRF.Proof));
    }

    function test_rollEndToEnd() public {
        vm.prank(player);
        uint256 id = dice.roll{value: 2 ether}();
        assertEq(dice.rollerOf(id), player);
        assertEq(coordinator.accruedFees(), 2 ether, "fee paid to coordinator");

        (,,, uint256 seed) = coordinator.pendingRequest(id);
        coordinator.fulfill(_prove(seed), id);

        uint256 result = dice.lastRoll(player);
        assertGe(result, 1);
        assertLe(result, 6);
        assertEq(result, (coordinator.responses(id) % 6) + 1);
        assertEq(dice.rollerOf(id), address(0), "request cleared");
    }

    function test_wrongFeeRejected() public {
        vm.prank(player);
        vm.expectRevert("send exactly the VRF fee");
        dice.roll{value: 1 ether}();
    }

    function test_onlyCoordinatorCanFulfill() public {
        vm.prank(player);
        vm.expectRevert("only coordinator");
        dice.rawFulfillRandomness(1, 42);
    }
}

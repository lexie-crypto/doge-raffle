// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";
import {DogeVRFCoordinator} from "../src/vrf/DogeVRFCoordinator.sol";

/// Deploy a replacement raffle alongside the funded legacy raffle. This
/// deliberately leaves the legacy contract, site, and keeper configuration
/// alone until its current round and claims have finished.
contract DeployRaffleV2 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address legacyAddress = vm.envAddress("LEGACY_RAFFLE_ADDRESS");
        require(legacyAddress.code.length != 0, "legacy raffle has no code");

        DogeRaffle legacy = DogeRaffle(payable(legacyAddress));
        require(legacy.owner() == deployer, "deployer must own legacy raffle");
        require(legacy.feeBps() == 500 && legacy.foundationBps() == 500, "first-round fee mismatch");

        address coordinatorAddress = legacy.vrfCoordinator();
        require(coordinatorAddress.code.length != 0, "coordinator has no code");
        DogeVRFCoordinator coordinator = DogeVRFCoordinator(coordinatorAddress);
        require(coordinator.owner() == deployer, "deployer must own coordinator");

        address treasury = legacy.treasury();
        address foundation = legacy.foundationWallet();
        address walletAdmin = legacy.walletAdmin();
        DogeRaffle.Bundle[] memory bundles = legacy.allBundles();
        uint64 timeout = legacy.vrfTimeout();
        uint256 bounty = legacy.callerBounty();

        vm.startBroadcast(deployerKey);
        DogeRaffle raffle = new DogeRaffle(deployer, treasury, foundation);
        raffle.setBundles(bundles);
        raffle.setWalletAdmin(walletAdmin);
        raffle.setVrfTimeout(timeout);
        raffle.setCallerBounty(bounty);
        coordinator.setFeeExempt(address(raffle), true);
        raffle.setVrfCoordinator(coordinatorAddress);
        raffle.pause(); // no new ticket sales until the legacy round is retired
        vm.stopBroadcast();

        console.log("Staged DogeRaffle v2:", address(raffle));
        console.log("Legacy raffle remains active:", legacyAddress);
        console.log("Shared VRF coordinator:", coordinatorAddress);
        console.log("Staged raffle sales: paused");
    }
}

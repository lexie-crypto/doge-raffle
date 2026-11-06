// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";
import {DogeVRFCoordinator} from "../src/vrf/DogeVRFCoordinator.sol";

/// Deploy to DogeOS Chikyu testnet:
///
///   export DEPLOYER_PRIVATE_KEY=0x...   # funded from https://faucet.testnet.dogeos.com
///   export RAFFLE_OWNER=0x...           # admin address (defaults to deployer)
///   export RAFFLE_TREASURY=0x...        # receives the protocol fee (defaults to deployer)
///   # VRF (recommended). Generate the keypair with:
///   #   node ../bot/ecvrf-cli.mjs pubkey <VRF_SECRET_KEY>
///   export VRF_PUBKEY_X=0x...
///   export VRF_PUBKEY_Y=0x...
///   forge script script/Deploy.s.sol --rpc-url dogeos_testnet --broadcast
///
/// Without VRF_PUBKEY_X/Y, only the raffle deploys (blockhash-only mode);
/// a coordinator can be attached later via raffle.setVrfCoordinator.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("RAFFLE_OWNER", deployer);
        address treasury = vm.envOr("RAFFLE_TREASURY", deployer);
        uint256 vrfPkX = vm.envOr("VRF_PUBKEY_X", uint256(0));
        uint256 vrfPkY = vm.envOr("VRF_PUBKEY_Y", uint256(0));

        vm.startBroadcast(deployerKey);

        DogeRaffle raffle = new DogeRaffle(owner, treasury);
        console.log("DogeRaffle deployed:", address(raffle));

        if (vrfPkX != 0 && vrfPkY != 0) {
            // Owner must be the deployer at wiring time; transfer later if needed.
            DogeVRFCoordinator coordinator = new DogeVRFCoordinator(deployer, [vrfPkX, vrfPkY]);
            coordinator.setFeeExempt(address(raffle), true);
            console.log("DogeVRFCoordinator deployed:", address(coordinator));
            if (owner == deployer) {
                raffle.setVrfCoordinator(address(coordinator));
                console.log("raffle wired to coordinator");
            } else {
                console.log("NOTE: call raffle.setVrfCoordinator(coordinator) from the owner");
            }
            if (owner != deployer) {
                coordinator.transferOwnership(owner);
                console.log("coordinator ownership offered to owner (2-step: owner must accept)");
            }
        } else {
            console.log("no VRF pubkey provided - blockhash-only mode");
        }

        vm.stopBroadcast();
        console.log("  owner:   ", owner);
        console.log("  treasury:", treasury);
    }
}

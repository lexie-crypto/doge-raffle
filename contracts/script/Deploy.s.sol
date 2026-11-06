// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";
import {DogeVRFCoordinator} from "../src/vrf/DogeVRFCoordinator.sol";

/// Deploy to DogeOS Chikyu testnet:
///
///   export DEPLOYER_PRIVATE_KEY=0x...   # funded from https://faucet.testnet.dogeos.com
///   export RAFFLE_OWNER=0x...           # admin address (defaults to deployer)
///   export RAFFLE_TREASURY=0x...        # receives the 5% protocol fee (defaults to deployer)
///   export RAFFLE_FOUNDATION=0x...      # Dogecoin Foundation wallet, receives 5% (defaults to deployer — SET THIS)
///   export WALLET_ADMIN=0x...           # optional: bot wallet allowed to update the two payout addresses from repo vars
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
        address foundation = vm.envOr("RAFFLE_FOUNDATION", deployer);
        address walletAdmin = vm.envOr("WALLET_ADMIN", address(0));
        uint256 vrfPkX = vm.envOr("VRF_PUBKEY_X", uint256(0));
        uint256 vrfPkY = vm.envOr("VRF_PUBKEY_Y", uint256(0));

        vm.startBroadcast(deployerKey);

        DogeRaffle raffle = new DogeRaffle(owner, treasury, foundation);
        console.log("DogeRaffle deployed:", address(raffle));
        if (foundation == deployer) {
            console.log("WARNING: RAFFLE_FOUNDATION not set - foundation fee goes to deployer until setFoundationWallet()");
        }
        if (owner == deployer) {
            // 1 / 5 / 10 / 100 / 1000 tickets at 20 -> 15 DOGE per ticket
            DogeRaffle.Bundle[] memory b = new DogeRaffle.Bundle[](5);
            b[0] = DogeRaffle.Bundle({tickets: 1, price: 20 ether});
            b[1] = DogeRaffle.Bundle({tickets: 5, price: 90 ether});
            b[2] = DogeRaffle.Bundle({tickets: 10, price: 170 ether});
            b[3] = DogeRaffle.Bundle({tickets: 100, price: 1_600 ether});
            b[4] = DogeRaffle.Bundle({tickets: 1000, price: 15_000 ether});
            raffle.setBundles(b);
        }
        if (walletAdmin != address(0)) {
            raffle.setWalletAdmin(walletAdmin);
            console.log("walletAdmin:", walletAdmin);
        }

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
        console.log("  foundation:", foundation);
    }
}

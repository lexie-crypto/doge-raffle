// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";

/// Deploy to DogeOS Chikyu testnet:
///
///   export DEPLOYER_PRIVATE_KEY=0x...   # funded from https://faucet.testnet.dogeos.com
///   export RAFFLE_OWNER=0x...           # admin address (defaults to deployer)
///   export RAFFLE_TREASURY=0x...        # receives the 5% fee (defaults to deployer)
///   forge script script/Deploy.s.sol --rpc-url dogeos_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("RAFFLE_OWNER", deployer);
        address treasury = vm.envOr("RAFFLE_TREASURY", deployer);

        vm.startBroadcast(deployerKey);
        DogeRaffle raffle = new DogeRaffle(owner, treasury);
        vm.stopBroadcast();

        console.log("DogeRaffle deployed:", address(raffle));
        console.log("  owner:   ", owner);
        console.log("  treasury:", treasury);
        console.log("  round 1 ends:", raffle.drawInterval());
    }
}

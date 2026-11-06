// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console} from "forge-std/Script.sol";
import {DogeRaffle} from "../src/DogeRaffle.sol";
import {DogeVRFCoordinator} from "../src/vrf/DogeVRFCoordinator.sol";

/// One-time testnet cutover. Old funds remain in the old contract; pause only
/// its ticket sales. Draws and claims remain permissionless there.
contract ActivateRaffleV2 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);
        DogeRaffle oldRaffle = DogeRaffle(payable(vm.envAddress("OLD_RAFFLE_ADDRESS")));
        DogeRaffle newRaffle = DogeRaffle(payable(vm.envAddress("NEW_RAFFLE_ADDRESS")));
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address foundation = vm.envAddress("FOUNDATION_ADDRESS");

        require(address(oldRaffle) != address(newRaffle), "identical raffles");
        require(address(oldRaffle).code.length != 0 && address(newRaffle).code.length != 0, "raffle has no code");
        require(oldRaffle.owner() == owner && newRaffle.owner() == owner, "deployer is not owner");
        address coordinatorAddress = oldRaffle.vrfCoordinator();
        require(newRaffle.vrfCoordinator() == coordinatorAddress, "coordinator mismatch");
        require(DogeVRFCoordinator(coordinatorAddress).feeExempt(address(newRaffle)), "v2 not fee exempt");
        require(newRaffle.reservedDoge() == 0, "unexpected v2 liabilities");

        vm.startBroadcast(deployerKey);
        if (!oldRaffle.paused()) oldRaffle.pause();
        if (newRaffle.treasury() != treasury) newRaffle.setTreasury(treasury);
        if (newRaffle.foundationWallet() != foundation) newRaffle.setFoundationWallet(foundation);
        if (newRaffle.paused()) newRaffle.unpause();
        vm.stopBroadcast();

        console.log("Old ticket sales paused:", address(oldRaffle));
        console.log("New raffle active:", address(newRaffle));
        console.log("Treasury:", treasury);
        console.log("Foundation:", foundation);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// Implemented by contracts that consume randomness from DogeVRFCoordinator.
interface IVRFConsumer {
    /// Called by the coordinator exactly once per fulfilled request.
    /// Implementations MUST restrict msg.sender to the coordinator.
    function rawFulfillRandomness(uint256 requestId, uint256 randomness) external;
}

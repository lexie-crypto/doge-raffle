// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Example DogeOS VRF consumer, shown verbatim in the developer docs
// (/docs#quickstart-solidity). Tested in test/DiceRoller.t.sol against the
// real coordinator with real ECVRF proofs.

interface IDogeVRFCoordinator {
    function requestFee() external view returns (uint256);
    function requestRandomness(bytes32 userSeed) external payable returns (uint256 requestId);
}

interface IVRFConsumer {
    function rawFulfillRandomness(uint256 requestId, uint256 randomness) external;
}

contract DiceRoller is IVRFConsumer {
    IDogeVRFCoordinator public immutable coordinator;

    mapping(uint256 => address) public rollerOf; // requestId => player
    mapping(address => uint256) public lastRoll; // player => 1..6

    event RollRequested(uint256 indexed requestId, address indexed player);
    event Rolled(uint256 indexed requestId, address indexed player, uint256 result);

    constructor(address coordinator_) {
        coordinator = IDogeVRFCoordinator(coordinator_);
    }

    /// Player pays the VRF fee; the result arrives in a later transaction.
    function roll() external payable returns (uint256 requestId) {
        uint256 fee = coordinator.requestFee();
        require(msg.value == fee, "send exactly the VRF fee");
        requestId = coordinator.requestRandomness{value: fee}(
            keccak256(abi.encode(msg.sender, block.number))
        );
        rollerOf[requestId] = msg.sender;
        emit RollRequested(requestId, msg.sender);
    }

    /// Called by the coordinator once the oracle's proof has been verified.
    function rawFulfillRandomness(uint256 requestId, uint256 randomness) external {
        require(msg.sender == address(coordinator), "only coordinator");
        address player = rollerOf[requestId];
        require(player != address(0), "unknown request");
        delete rollerOf[requestId];

        uint256 result = (randomness % 6) + 1;
        lastRoll[player] = result;
        emit Rolled(requestId, player, result);
    }
}

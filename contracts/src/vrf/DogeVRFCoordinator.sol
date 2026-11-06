// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRF} from "./vendor/VRF.sol";
import {IVRFConsumer} from "./IVRFConsumer.sol";

/// @title DogeVRFCoordinator — verifiable randomness service for DogeOS
///
/// Chainlink-style request/fulfill VRF, self-operated. Consumers call
/// {requestRandomness} (paying a flat fee in native DOGE unless fee-exempt);
/// the oracle operator computes an ECVRF proof off-chain with its secret key
/// and submits it via {fulfill}. The proof is verified ON-CHAIN against the
/// registered public key (Chainlink's MIT-licensed secp256k1 ECVRF verifier,
/// vendored in ./vendor/VRF.sol), so neither the oracle nor the sequencer can
/// forge or bias the output — anyone can re-verify every fulfillment.
///
/// Trust model: outputs are unforgeable, but the key holder sees the output
/// before posting and could WITHHOLD a response. Consumers must implement
/// their own liveness fallback (e.g. DogeRaffle falls back to its blockhash
/// path after a timeout), which makes withholding observable and profitless.
///
/// Monetization: per-request fee in DOGE, accrued in the contract and
/// withdrawable by the owner. House consumers can be whitelisted fee-exempt.
contract DogeVRFCoordinator is VRF, Ownable2Step, ReentrancyGuard {
    struct Request {
        address consumer;
        uint64 requestedAt;
        bool fulfilled;
        uint256 seed; // full VRF input seed (domain-separated, see below)
    }

    /// Registered oracle public key (secp256k1, affine). Proofs must be
    /// generated with the matching secret key.
    uint256[2] public oraclePublicKey;
    bytes32 public keyHash; // keccak256(abi.encode(oraclePublicKey))

    uint256 public requestFee = 2 ether; // 2 DOGE per request (owner-settable)
    mapping(address => bool) public feeExempt;
    uint32 public callbackGasLimit = 500_000;

    uint256 public lastRequestId;
    mapping(uint256 => Request) public requests;
    /// Fulfilled outputs, readable even if the consumer callback failed.
    mapping(uint256 => uint256) public responses;

    uint256 public accruedFees;

    event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint256 seed);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 randomness, bool callbackSuccess);
    event OracleKeySet(uint256[2] publicKey, bytes32 keyHash);
    event RequestFeeSet(uint256 fee);
    event FeeExemptSet(address indexed consumer, bool exempt);
    event CallbackGasLimitSet(uint32 gasLimit);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error WrongFee(uint256 expected, uint256 sent);
    error UnknownRequest();
    error AlreadyFulfilled();
    error WrongKey();
    error WrongSeed();
    error KeyNotSet();
    error ZeroAddress();
    error WithdrawFailed();

    constructor(address initialOwner, uint256[2] memory publicKey) Ownable(initialOwner) {
        _setOracleKey(publicKey);
    }

    // ------------------------------------------------------------ requests

    /// Request a random value. Fee-exempt consumers pay nothing; everyone
    /// else pays exactly `requestFee`. The VRF input seed is domain-separated
    /// over chain, coordinator, request id, consumer and the caller's seed,
    /// so no two requests (or deployments) can share an output.
    function requestRandomness(bytes32 userSeed) external payable returns (uint256 requestId) {
        if (keyHash == bytes32(0)) revert KeyNotSet();
        uint256 expected = feeExempt[msg.sender] ? 0 : requestFee;
        if (msg.value != expected) revert WrongFee(expected, msg.value);
        accruedFees += msg.value;

        requestId = ++lastRequestId;
        uint256 seed =
            uint256(keccak256(abi.encode(block.chainid, address(this), requestId, msg.sender, userSeed)));
        requests[requestId] =
            Request({consumer: msg.sender, requestedAt: uint64(block.timestamp), fulfilled: false, seed: seed});
        emit RandomnessRequested(requestId, msg.sender, seed);
    }

    /// Submit an ECVRF proof for a pending request. Permissionless: the proof
    /// is self-authenticating (it verifies against the registered key), so it
    /// does not matter who delivers it. The consumer callback is best-effort
    /// with bounded gas; the output is stored in {responses} regardless, so a
    /// reverting consumer can still read its randomness.
    function fulfill(Proof calldata proof, uint256 requestId) external nonReentrant {
        Request storage request = requests[requestId];
        if (request.consumer == address(0)) revert UnknownRequest();
        if (request.fulfilled) revert AlreadyFulfilled();
        if (keccak256(abi.encode(proof.pk)) != keyHash) revert WrongKey();
        if (proof.seed != request.seed) revert WrongSeed();

        // Reverts on any invalid proof.
        uint256 randomness = _randomValueFromVRFProof(proof, request.seed);

        request.fulfilled = true;
        responses[requestId] = randomness;

        (bool ok,) = request.consumer.call{gas: callbackGasLimit}(
            abi.encodeCall(IVRFConsumer.rawFulfillRandomness, (requestId, randomness))
        );
        emit RandomnessFulfilled(requestId, randomness, ok);
    }

    // --------------------------------------------------------------- views

    function pendingRequest(uint256 requestId)
        external
        view
        returns (address consumer, uint64 requestedAt, bool fulfilled, uint256 seed)
    {
        Request storage request = requests[requestId];
        return (request.consumer, request.requestedAt, request.fulfilled, request.seed);
    }

    // --------------------------------------------------------------- admin

    /// Rotate the oracle key. Pending requests made under the old key must be
    /// fulfilled with proofs from the NEW key (seed is key-independent).
    function setOracleKey(uint256[2] calldata publicKey) external onlyOwner {
        _setOracleKey(publicKey);
    }

    function _setOracleKey(uint256[2] memory publicKey) private {
        // Full on-curve check so a bad key can't brick fulfillment.
        require(_isOnCurve(publicKey), "key not on curve");
        oraclePublicKey = publicKey;
        keyHash = keccak256(abi.encode(publicKey));
        emit OracleKeySet(publicKey, keyHash);
    }

    function setRequestFee(uint256 newFee) external onlyOwner {
        requestFee = newFee;
        emit RequestFeeSet(newFee);
    }

    function setFeeExempt(address consumer, bool exempt) external onlyOwner {
        feeExempt[consumer] = exempt;
        emit FeeExemptSet(consumer, exempt);
    }

    function setCallbackGasLimit(uint32 newLimit) external onlyOwner {
        callbackGasLimit = newLimit;
        emit CallbackGasLimitSet(newLimit);
    }

    /// Withdraw accrued request fees. Can never touch anything else — the
    /// contract holds no other funds.
    function withdrawFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = accruedFees;
        accruedFees = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit FeesWithdrawn(to, amount);
    }
}

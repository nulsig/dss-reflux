// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DMAP.sol";
import "./SignalVault.sol";

/**
 * @title Honeypot
 * @notice A contract designed to bait and trap pre-consensus front-runners.
 * It appears to offer a profitable opportunity, but the profit can only be unlocked
 * if the caller also registers a specific signal hash via the DMAP contract,
 * thus forcing attribution. This is non-consensual yield attribution.
 */
contract Honeypot {
    IDMAP public immutable dmap;
    SignalVault public immutable vault;
    address public immutable beneficiary;

    event Trapped(address indexed frontrunner, bytes32 indexed signalHash, uint256 profit);

    constructor(address _dmap, address _vault, address _beneficiary) {
        dmap = IDMAP(_dmap);
        vault = SignalVault(_vault);
        beneficiary = _beneficiary;
    }

    /**
     * @notice This function appears to be a profitable arbitrage opportunity.
     * To unlock the profit, the caller MUST also call dmap.registerSignal(description, categoryId)
     * in the same transaction, creating a permanent, verifiable link between their
     * action and your signal. The captured value is then registered in the SignalVault.
     */
    function execute(string calldata description, uint256 categoryId) external payable {
        // Force attribution — front-runner must call your registry
        bytes32 signalHash = dmap.registerSignal(description, categoryId);

        // Log the trapped event
        emit Trapped(msg.sender, signalHash, msg.value);

        // Register the yield in the SignalVault
        // This creates a claimable record of the captured value
        vault.logYield(signalHash, msg.sender, msg.value, bytes("")); // Signature is empty for now
    }
}


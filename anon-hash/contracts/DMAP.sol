// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract DMAP {

    struct Signal {
        address owner;
        string description;
        uint256 categoryId;
    }

    event SignalRegistered(bytes32 indexed hash, address indexed owner, uint256 categoryId, string description);

    mapping(bytes32 => Signal) public signals;

    function registerSignal(string calldata description, uint256 categoryId) external returns (bytes32) {
        bytes32 hash = keccak256(abi.encodePacked(msg.sender, block.chainid, description, categoryId));
        require(signals[hash].owner == address(0), "Signal already registered");

        signals[hash] = Signal({
            owner: msg.sender,
            description: description,
            categoryId: categoryId
        });

        emit SignalRegistered(hash, msg.sender, categoryId, description);
        return hash;
    }

    function getSignal(bytes32 hash) external view returns (Signal memory) {
        return signals[hash];
    }


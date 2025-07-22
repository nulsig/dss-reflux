// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SignalVault.sol";

contract Create2Factory {
    event Deployed(address addr, bytes32 salt);

    function deploy(bytes memory bytecode, bytes32 salt) external returns (address addr) {
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
        emit Deployed(addr, salt);
    }

    function deployAndAuthorize(bytes memory bytecode, bytes32 salt, SignalVault vault) external returns (address addr) {
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
        vault.setAuthorizedTrapper(addr, true);
        emit Deployed(addr, salt);
    }

    function computeAddress(bytes memory bytecode, bytes32 salt) external view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }
}


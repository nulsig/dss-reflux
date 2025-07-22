// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// --- Interfaces ---
interface IDMAP {
    function registerSignal(string calldata description, uint256 categoryId) external returns (bytes32);
    function getSignal(bytes32 hash) external view returns (address, string memory, uint256);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

// LayerZero Interface
interface ILayerZeroEndpoint {
    function send(uint16 _dstChainId, bytes calldata _toAddress, bytes calldata _payload, address payable _refundAddress, address _zroPaymentAddress, bytes calldata _adapterParams) external payable;
}

/**
 * @title SignalVault
 * @notice Decentralized, non-custodial vault for MEV-correlated yield capture with advanced features.
 */
contract SignalVault is ReentrancyGuard, Ownable {

    // --- Events ---
    event YieldLogged(bytes32 indexed signalHash, address indexed frontrunner, uint256 yieldAmount, bool proofValid);
    event YieldHarvested(address indexed emitter, uint256 amount);
    event YieldClaimed(address indexed claimer, uint256 amount);
    event YieldLocked(address indexed user, uint256 amount, uint256 releaseTime);
    event TrapperAuthorized(address indexed trapper, bool isAuthorized);

    // --- Structs ---
    struct Signal {
        address emitter;
        uint256 blockEmitted;
    }

    struct YieldLock {
        uint256 amount;
        uint256 releaseTime;
    }

    // --- Constants ---
    uint256 public YIELD_LOCK_DURATION = 1 days;

    // --- State ---
    IDMAP public immutable dmap;
    IWETH public immutable weth;
    mapping(bytes32 => Signal) public signals;
    mapping(address => uint256) public harvestedYield;
    mapping(address => YieldLock) public yieldLocks;
    mapping(address => bool) public authorizedTrappers;
    
    // --- LayerZero State ---
    ILayerZeroEndpoint public layerZeroEndpoint;
    mapping(uint16 => bytes) public remoteAddress;

    // --- Constructor ---
    constructor(address _dmap, address _weth) {
        dmap = IDMAP(_dmap);
        weth = IWETH(_weth);
    }

    // --- Core Logic ---

    function logYield(bytes32 signalHash, address frontrunner, uint256 yieldAmount, bytes calldata signature) external {
        require(authorizedTrappers[msg.sender], "Not an authorized trapper");

        (address signalOwner, ,) = dmap.getSignal(signalHash);
        require(signalOwner != address(0), "Signal does not exist");

        // Attribution Proof Verification
        bytes32 proofHash = keccak256(abi.encodePacked(signalHash, frontrunner, yieldAmount));
        address signer = ECDSA.recover(proofHash, signature);
        bool proofValid = (signer == signalOwner);

        harvestedYield[signalOwner] += yieldAmount;
        emit YieldLogged(signalHash, frontrunner, yieldAmount, proofValid);
    }

    function harvestYield(bytes32[] calldata hashes) external nonReentrant {
        uint256 totalHarvest = 0;
        for (uint i = 0; i < hashes.length; unchecked { i++ }) {
            bytes32 hash = hashes[i];
            (address signalOwner, ,) = dmap.getSignal(hash);
            require(signalOwner == msg.sender, "Not your signal");

            // Simplified yield calculation for example
            uint256 yield = harvestedYield[msg.sender];
            if (yield > 0) {
                totalHarvest += yield;
            }
        }
        require(totalHarvest > 0, "No yield to harvest");

        // Apply YieldLock Mechanism
        yieldLocks[msg.sender] = YieldLock({
            amount: yieldLocks[msg.sender].amount + totalHarvest,
            releaseTime: block.timestamp + YIELD_LOCK_DURATION
        });

        emit YieldHarvested(msg.sender, totalHarvest);
        emit YieldLocked(msg.sender, totalHarvest, block.timestamp + YIELD_LOCK_DURATION);
    }

    function withdrawYield(uint256 amount) external nonReentrant {
        uint256 userYield = harvestedYield[msg.sender];
        require(userYield >= amount, "Insufficient yield");
        require(yieldLocks[msg.sender].releaseTime < block.timestamp, "Yield is timelocked");

        harvestedYield[msg.sender] -= amount;
        weth.withdraw(amount);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        emit YieldClaimed(msg.sender, amount);
    }

    function releaseYield() external nonReentrant {
        YieldLock storage lock = yieldLocks[msg.sender];
        require(lock.amount > 0, "No locked yield");
        require(lock.releaseTime < block.timestamp, "Timelock has not expired");

        uint256 amountToRelease = lock.amount;
        lock.amount = 0;
        lock.releaseTime = 0;

        harvestedYield[msg.sender] += amountToRelease;
    }

    // --- Autonomous Functions ---
    function autoCompound() external {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            weth.deposit{value: balance}();
        }
    }
    
    // --- LayerZero Functions ---
    function setLayerZeroEndpoint(address _layerZeroEndpoint) external onlyOwner {
        layerZeroEndpoint = ILayerZeroEndpoint(_layerZeroEndpoint);
    }

    function setRemote(uint16 _dstChainId, bytes calldata _remoteAddress) external onlyOwner {
        remoteAddress[_dstChainId] = _remoteAddress;
    }

    function withdrawYieldToChain(uint16 _dstChainId, address _toAddress, uint256 _amount) external payable nonReentrant {
        require(remoteAddress[_dstChainId].length != 0, "Destination chain not supported");
        uint256 userYield = harvestedYield[msg.sender];
        require(userYield >= _amount, "Insufficient yield");

        harvestedYield[msg.sender] -= _amount;

        bytes memory toAddressBytes = abi.encodePacked(_toAddress);
        bytes memory payload = abi.encode(_amount);

        weth.withdraw(_amount);

        layerZeroEndpoint.send{value: msg.value}(
            _dstChainId,
            toAddressBytes,
            payload,
            payable(msg.sender),
            address(0),
            bytes("")
        );
    }

    // --- Admin ---
    function setAuthorizedTrapper(address trapper, bool authorized) external onlyOwner {
        authorizedTrappers[trapper] = authorized;
        emit TrapperAuthorized(trapper, authorized);
    }
    
    // --- Receive Ether ---
    receive() external payable {}
}


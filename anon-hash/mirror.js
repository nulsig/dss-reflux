// Mirror Bot - Creates the economic feedback loop by following your own signals
// This turns your semantic signals into visible MEV opportunities

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const jamStore = require('./jam-store');

// Import DEX configurations for recursive alignment with amplifier
const { DEX_CONFIGS, TOKENS, selectOptimalDEX } = require('./dex-config');

// IMPORTANT: Use a DIFFERENT wallet for mirroring
const MIRROR_PRIVATE_KEY = process.env.MIRROR_PRIVATE_KEY || process.env.PRIVATE_KEY;
const YOUR_SIGNAL_WALLET = process.env.WALLET_ADDRESS || '__YOUR_WALLET_ADDRESS__';

// Contract addresses
const DMAP_ADDRESS = process.env.DMAP_ADDRESS;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;

// Setup provider - use single reliable RPC to avoid quorum issues
const rpcUrl = process.env.RPC_URL || 'https://base.publicnode.com';
console.log(`Using RPC URL: ${rpcUrl}`);

let provider;
try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    console.log('RPC provider initialized');
} catch (error) {
    console.error('RPC provider initialization failed:', error.message);
    process.exit(1);
}

const mirrorWallet = new ethers.Wallet(MIRROR_PRIVATE_KEY, provider);

// Contract interfaces
const dmap = new ethers.Contract(
  DMAP_ADDRESS,
  [\"event SignalRegistered(bytes32 indexed hash)\"],
  provider
);

const vault = new ethers.Contract(
  VAULT_ADDRESS,
  [
    \"function feedActivity() external payable\",
    \"function emitSignal(bytes32) external\",
    \"function emitRecursiveSignal(bytes32, bytes32) external\",
    \"function proverbs(bytes32) external view returns (address, uint256, bool, string, string)\"
  ],
  mirrorWallet
);

// Simplified router ABI to avoid conflicts
const routerABI = [
  // Standard Uniswap V2 Router functions
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external"
];
let router;
try {
    if (!ACTIVE_ROUTER) {
        console.error('ACTIVE_ROUTER is not defined. Using default Uniswap V3 router.');
        ACTIVE_ROUTER = DEFAULT_ROUTER;
    }
    router = new ethers.Contract(ACTIVE_ROUTER, routerABI, mirrorWallet);
} catch (error) {
    console.error('Failed to initialize router contract:', error.message);
    process.exit(1);
}

// Validate jamStore contents before accessing
function safeRetrieveJam(hash) {
    const data = jamStore.retrieve(hash);
    return data ? { proverb: data.proverb ?? [], meta: data.meta ?? {}, tags: data.tags ?? [] } : { proverb: [], meta: {}, tags: [] };
}

// Track mirrored signals to avoid duplicates
const mirroredSignals = new Set();
let totalMirrored = 0;
let totalValueCreated = BigInt(0);
const ENABLE_RECURSIVE_SIGNALS = process.env.ENABLE_RECURSIVE_SIGNALS === 'true';

// Track signal relationships for recursive emissions
const signalLineage = new Map(); // child -> parent mapping
let recursionDepth = 0; // Track recursion depth

// Global consensus clock times for amplified mirroring (UTC)
const CONSENSUS_TIMES = [
  { hour: 13, minute: 21 }, // 13:21 UTC
  { hour: 21, minute: 1 },  // 21:01 UTC
  { hour: 3, minute: 33 },  // 03:33 UTC
  { hour: 8, minute: 1 },   // 08:01 UTC
  { hour: 20, minute: 8 }   // 20:08 UTC (8:08 PM)
];

// Enhanced phi-aligned consensus window detection
function getMinDistanceToConsensusWindow() {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentMinutes = currentHour * 60 + currentMinute;

  return CONSENSUS_TIMES.reduce((minDist, time) => {
    const windowMinutes = time.hour * 60 + time.minute;
    const distance = Math.min(
      Math.abs(currentMinutes - windowMinutes),
      Math.abs(currentMinutes - windowMinutes + 1440), // Next day
      Math.abs(currentMinutes - windowMinutes - 1440)  // Previous day
    );
    return Math.min(minDist, distance);
  }, Infinity);
}

function getConsensusMultiplier() {
  const minDistance = getMinDistanceToConsensusWindow();
  if (minDistance <= 2) return 2.618; // φ + 1 for perfect alignment
  if (minDistance <= 5) return 1.618; // φ for near alignment
  if (minDistance <= 10) return 1.382; // φ-1 for approaching
  return 1;
}

function calculateOptimalWaitTime(minDistance, signalConfidence) {
  const PHI = 1.618033988749895;
  let baseWait = 0;
  
  if (minDistance <= 3) {
    baseWait = 1000; // Almost immediate for perfect alignment
  } else if (minDistance <= 8) {
    baseWait = (minDistance * PHI) * 1000; // Phi-scaled short wait
  } else if (minDistance <= 13) {
    baseWait = (minDistance * PHI * PHI) * 1000; // Phi-squared medium wait
  } else {
    baseWait = Math.min(
      (minDistance * PHI * PHI * PHI) * 1000, // Phi-cubed long wait
      2.618 * 60 * 1000 // Max 2.618 minutes
    );
  }
  
  // Adjust by confidence
  return Math.floor(baseWait * (1 - (signalConfidence * 0.1)));
}

function isConsensusTime() {
  return getMinDistanceToConsensusWindow() <= 2;
}

const erc20ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];
const aaveABI = [
  "function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external"
];
const AAVE_POOL_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'; // Aave V3 Pool on Base
const aaveContract = new ethers.Contract(AAVE_POOL_ADDRESS, aaveABI, mirrorWallet);
const usdcContract = new ethers.Contract(TOKENS.USDC, erc20ABI, mirrorWallet);

console.log('Mirror Bot Started - CAUSAL ENGINE MODE');
console.log(`Watching for signals from: ${YOUR_SIGNAL_WALLET}`);
console.log(`Causal mirror wallet: ${mirrorWallet.address}`);
console.log(`Primary DEX: ${ACTIVE_DEX_NAME} (${ACTIVE_ROUTER})`);
console.log(`Will execute the SECOND step of on-chain proverbs.`);
console.log(`\nPHI-TIMED CONSENSUS WINDOWS (UTC):`);
console.log(`   13:21 - Fibonacci time alignment`);
console.log(`   21:01 - Mirror of 01:21`);
console.log(`   03:33 - Trinity alignment`);
console.log(`   08:01 - New cycle beginning`);
console.log(`   20:08 - Evening consensus\n`);
console.log(`TIMING STRATEGY:`);
console.log(`   [IMMEDIATE] Within +/-3 min of phi window -> Mirror immediately`);
console.log(`   [WAIT] Within 10 min -> Wait for phi window`);
console.log(`   [MOMENTUM] Amplifier just fired -> Mirror in 5 seconds`);
console.log(`   [PHI-SCALED] Otherwise -> Phi-scaled delay (max 2.618 min)\n`);

// Helper to parse JAM from your emission pattern
async function getJAMPrediction(hash, blockNumber) {
  // In production, fetch from IPFS using jam.pattern.ipfs
  // For now, we'll use the known pattern from your signals
  
  // Your JAMs predict based on gas conditions
  const block = await provider.getBlock(blockNumber);
const gasPrice = block.baseFeePerGas || ethers.parseUnits('1', 'gwei');
  const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
  
  // Mirror your exact prediction logic with minimal gas optimization
  let swapPath = [WETH, USDC];
  let strategy = "monitor";
  
  // Phi-aligned base amount (golden ratio: 1.618033988749895)
  const PHI = 1.618033988749895;
let tradeAmount = ethers.parseEther("0.00001618");
  
// CONSENSUS TIME AMPLIFICATION: Use phi for alignment windows
  const consensusMultiplier = isConsensusTime() ? 2.618 : 1; // φ + 1 during consensus windows as per docs
  
  // Apply 1.44x boost for high confidence signals (>0.95)
  const confidenceBoost = 0.9 > 0.95 ? 1.44 : 1;
  
  // Scale by phi for extreme conditions (recursive golden ratio)
  if (gasPriceGwei > 75) {
    strategy = "mev_sandwich_premium";
    // 0.00001618 * phi^3 * confidence boost
tradeAmount = ethers.parseEther((0.00001618 * Math.pow(PHI, 3) * consensusMultiplier * confidenceBoost).toFixed(8));
  } else if (gasPriceGwei > 50) {
    strategy = "mev_sandwich";
    // 0.00001618 * phi^2 * confidence boost
tradeAmount = ethers.parseEther((0.0001618 * Math.pow(PHI, 2) * consensusMultiplier * confidenceBoost).toFixed(8));
  } else if (gasPriceGwei > 25) {
    strategy = "arbitrage";
    // 0.00001618 * phi * confidence boost
tradeAmount = ethers.parseEther((0.0001618 * PHI * consensusMultiplier * confidenceBoost).toFixed(8));
  } else {
    // Base amount with consensus amplification and confidence boost
tradeAmount = ethers.parseEther((0.0001618 * consensusMultiplier * confidenceBoost).toFixed(8));
  }
  
  // Log consensus amplification
  if (consensusMultiplier > 1) {
    console.log(`CONSENSUS TIME DETECTED: Amplifying by ${consensusMultiplier}x`);
  }

  // Cache the prediction
  lastKnownPrediction = {
    path: swapPath,
    strategy: strategy,
    amount: tradeAmount,
    confidence: gasPriceGwei > 25 ? 0.9 : 0.7
  };

  return lastKnownPrediction;
}

// Main mirror logic with polling instead of filters
let filterRetryCount = 0;
const maxFilterRetries = 3;

async function setupEventListener() {
  try {
    // Use polling instead of filters for better compatibility with public RPCs
    const pollInterval = 12000; // 12 seconds (Base block time is ~2s)
    let lastProcessedBlock = await provider.getBlockNumber();
    
    setInterval(async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        if (currentBlock > lastProcessedBlock) {
          const filter = dmap.filters.SignalRegistered();
          const events = await dmap.queryFilter(filter, lastProcessedBlock + 1, currentBlock);
          
          for (const event of events) {
            // Process the event
            processSignalEvent(event.args.hash, event);
          }
          
          lastProcessedBlock = currentBlock;
        }
      } catch (error) {
        if (!error.message.includes('filter not found')) {
          console.error('Error polling for events:', error.message);
        }
      }
    }, pollInterval);
    
    console.log('Event polling started successfully');
  } catch (error) {
    console.error('Failed to setup event listener:', error.message);
    if (filterRetryCount < maxFilterRetries) {
      filterRetryCount++;
      console.log(`Retrying event listener setup (${filterRetryCount}/${maxFilterRetries})...`);
      setTimeout(() => setupEventListener(), 5000);
    }
  }
}

// Replace the direct event listener with polling
setupEventListener();

// Process signal events
async function processSignalEvent(hash, event) {
  try {
    // Check if event is undefined before trying to access properties
    if (!event) {
      console.error(`Error: Received undefined event for hash ${hash}`);
      return;
    }
    
    const tx = await event.getTransaction();
    
    // Only mirror YOUR signals
    if (tx.from.toLowerCase() !== YOUR_SIGNAL_WALLET.toLowerCase()) {
      return;
    }
    
    // Skip if already mirrored
    if (mirroredSignals.has(hash)) {
      return;
    }
    
    console.log(`\nYour signal detected!`);
    console.log(`Hash: ${hash}`);
    console.log(`Block: ${event.blockNumber}`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // ALIGNED: The mirror must now verify the JAM's integrity before acting.
const { proverb, meta, tags } = safeRetrieveJam(hash);
if (!meta.audit_pass) {
  console.log(`[ABORT] JAM ${hash.slice(0, 10)}... failed audit or is missing verification. Mirror will not act.`);
  return;
}

console.log(`[JAM-VERIFIED] Audit passed. Proceeding with mirror execution.`);

// Check if proverb exists and is an array
if (!Array.isArray(proverb)) {
  console.log(`[ERROR] Invalid proverb format: ${typeof proverb}`);
  return;
}

const myStep = proverb.find(step => step && step.actor === 'MIRROR');

if (!myStep) {
  console.log(`[SKIP] Proverb has no step for the mirror to execute.`);
  return;
}

console.log(`[PROVERB] Will execute Step 2: ${myStep.action} (${myStep.from} -> ${myStep.to})`);

    // Safely access tags with a default if not present
    const proverbName = Array.isArray(tags) ? 
      tags.find(t => t && typeof t === 'string' && t.startsWith("VOICE:")) || "UNKNOWN_PROVERB" : 
      "UNKNOWN_PROVERB";
    console.log(`Executing story: ${proverbName}`);
    
    // --- (Phi-timed wait logic can remain here) ---
    // This adds semantic timing to the execution of the proverb's second step
    const waitTime = calculateOptimalWaitTime(getMinDistanceToConsensusWindow(), 0.9);
    console.log(`Waiting ${(waitTime / 1000).toFixed(1)}s to continue the story...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // --- Execute My Assigned Step in the Proverb ---
    try {
        if (myStep.action === 'SWAP') {
            // Handle WETH/ETH mapping
            let tokenFrom, tokenTo;
            if (myStep.from === 'ETH' || myStep.from === 'WETH') {
                tokenFrom = WETH;
            } else {
                tokenFrom = TOKENS[myStep.from];
                if (!tokenFrom) {
                    console.error(`[ERROR] Unknown token: ${myStep.from}`);
                    console.error(`[DEBUG] Available tokens:`, Object.keys(TOKENS));
                    return;
                }
            }
            
            if (myStep.to === 'ETH' || myStep.to === 'WETH') {
                tokenTo = WETH;
            } else {
                tokenTo = TOKENS[myStep.to];
                if (!tokenTo) {
                    console.error(`[ERROR] Unknown token: ${myStep.to}`);
                    console.error(`[DEBUG] Available tokens:`, Object.keys(TOKENS));
                    return;
                }
            }
            
            const tokenFromContract = new ethers.Contract(tokenFrom, erc20ABI, mirrorWallet);
            const fromBalance = await tokenFromContract.balanceOf(mirrorWallet.address);
            const decimals = await tokenFromContract.decimals();

            if (fromBalance === 0n) {
              console.log(`[SKIP] No ${myStep.from} balance to swap.`);
              return;
            }

console.log(`[ALIGNMENT] Approving router to spend ${ethers.formatUnits(fromBalance, decimals)} ${myStep.from}...`);
            const approveTx = await tokenFromContract.approve(ACTIVE_ROUTER, fromBalance);
            await approveTx.wait();
            console.log(`[ALIGNMENT] Approval complete. Tx: ${approveTx.hash}`);

            console.log(`Executing SWAP action: ${myStep.from} -> ${myStep.to}`);
            
            const swapPath = [tokenFrom, tokenTo];
            const deadline = Math.floor(Date.now() / 1000) + 300;
            
            const tx = await vault.executeProverb(hash, myStep.from, myStep.to, { gasLimit: 200000 });
            await tx.wait();
            
            console.log(`[SUCCESS] Mirror swap executed. Tx: ${tx.hash}`);
            totalMirrored++;
        } else if (myStep.action === 'DEPOSIT_AAVE' || myStep.action === 'DEPOSIT') {
            console.log(`Executing ${myStep.action} action: Depositing ${myStep.from}`);
            
            // Handle WETH/ETH mapping
            let tokenAddress;
            if (myStep.from === 'ETH' || myStep.from === 'WETH') {
                tokenAddress = WETH;
            } else {
                tokenAddress = TOKENS[myStep.from];
                if (!tokenAddress) {
                    console.error(`[ERROR] Unknown token: ${myStep.from}`);
                    console.error(`[DEBUG] Available tokens:`, Object.keys(TOKENS));
                    return;
                }
            }
            
            const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, mirrorWallet);
            const balance = await tokenContract.balanceOf(mirrorWallet.address);
            const decimals = await tokenContract.decimals();

            if (balance === 0n) {
              console.log(`[SKIP] No ${myStep.from} balance to deposit.`);
              return;
            }
            
            console.log(`[ALIGNMENT] Using full ${myStep.from} balance of ${ethers.formatUnits(balance, decimals)} for deposit.`);

            // Approve Aave to spend tokens
            await tokenContract.approve(AAVE_POOL_ADDRESS, balance);

            const tx = await aaveContract.deposit(tokenAddress, balance, mirrorWallet.address, 0);
            await tx.wait();
            console.log(`[SUCCESS] Deposited ${myStep.from} to Aave. Tx: ${tx.hash}`);
            
        } else if (myStep.action === 'DEPOSIT_COMPOUND') {
            console.log(`Executing DEPOSIT_COMPOUND action: ${myStep.from} -> ${myStep.to}`);
            
            const tokenAddress = TOKENS[myStep.from];
            const cTokenAddress = TOKENS[myStep.to];
            const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, mirrorWallet);
            const balance = await tokenContract.balanceOf(mirrorWallet.address);
            const decimals = await tokenContract.decimals();

            if (balance === 0n) {
              console.log(`[SKIP] No ${myStep.from} balance to deposit.`);
              return;
            }
            
            // Compound cToken ABI for minting
            const cTokenABI = [
              "function mint(uint256 mintAmount) returns (uint256)",
              "function redeem(uint256 redeemTokens) returns (uint256)"
            ];
            const cTokenContract = new ethers.Contract(cTokenAddress, cTokenABI, mirrorWallet);
            
            console.log(`[ALIGNMENT] Depositing ${ethers.formatUnits(balance, decimals)} ${myStep.from} to Compound...`);
            
            // Approve cToken to spend underlying token
            await tokenContract.approve(cTokenAddress, balance);
            
            const tx = await cTokenContract.mint(balance, { gasLimit: 300000 });
            await tx.wait();
            console.log(`[SUCCESS] Deposited ${myStep.from} to Compound (received ${myStep.to}). Tx: ${tx.hash}`);
            
        } else if (myStep.action === 'DEPOSIT_SAVINGS') {
            console.log(`Executing DEPOSIT_SAVINGS action: ${myStep.from} -> ${myStep.to}`);
            
            // For sDAI deposits on Base (Spark Protocol)
            const daiAddress = TOKENS.DAI;
            const sDaiAddress = TOKENS.sDAI;
            const daiContract = new ethers.Contract(daiAddress, erc20ABI, mirrorWallet);
            const balance = await daiContract.balanceOf(mirrorWallet.address);
            const decimals = await daiContract.decimals();

            if (balance === 0n) {
              console.log(`[SKIP] No DAI balance to deposit.`);
              return;
            }
            
            // sDAI deposit ABI
            const sDaiABI = [
              "function deposit(uint256 assets, address receiver) returns (uint256 shares)"
            ];
            const sDaiContract = new ethers.Contract(sDaiAddress, sDaiABI, mirrorWallet);
            
            console.log(`[ALIGNMENT] Depositing ${ethers.formatUnits(balance, decimals)} DAI to Savings DAI...`);
            
            // Approve sDAI to spend DAI
            await daiContract.approve(sDaiAddress, balance);
            
            const tx = await sDaiContract.deposit(balance, mirrorWallet.address, { gasLimit: 200000 });
            await tx.wait();
            console.log(`[SUCCESS] Deposited DAI to sDAI. Tx: ${tx.hash}`);
            
        } else {
            console.error(`[FAIL] Unknown action in proverb: ${myStep.action}`);
            return;
        }

        mirroredSignals.add(hash);
        console.log(`[PROVERB COMPLETE] Story ${proverbName} has been told on-chain.`);

    } catch (e) {
        console.error(`[FAIL] Failed to execute proverb step: ${e.message}`);
    }
  } catch (error) {
    console.error(`Error processing signal:`, error.message);
  }
}

// Status heartbeat
setInterval(() => {
  const runtime = Math.floor(process.uptime() / 60);
  console.log(`\nMirror bot alive - ${runtime}m runtime, ${totalMirrored} mirrors executed`);
}, 300000); // Every 5 minutes

console.log('\nMirror bot ready. Waiting for your signals...\n');

// Watch for copycat swaps in the mempool with dynamic block range management
async function watchForCopycats(originalTxHash, prediction, originalSignalHash) {
  let startBlock;
  let watchDuration = 10; // Watch for 10 blocks
  let endTime = Date.now() + (watchDuration * 12 * 1000); // Approximate 12 seconds per block
  
  try {
    startBlock = await provider.getBlockNumber();
    console.log(`Watching for copycats of ${originalTxHash.slice(0, 10)}... (from block ${startBlock})`);
  } catch (error) {
    console.error(`Failed to get start block for copycat watching: ${error.message}`);
    return;
  }
  
  const checkInterval = setInterval(async () => {
    try {
      // Check if we've exceeded our time limit
      if (Date.now() > endTime) {
        console.log(`Copycat watching period ended for ${originalTxHash.slice(0, 10)}`);
        clearInterval(checkInterval);
        return;
      }
      
      // Get current block with timeout protection
      const currentBlock = await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Block number timeout')), 5000))
      ]);
      
      // Validate block range
      if (currentBlock < startBlock) {
        console.warn(`Current block ${currentBlock} is less than start block ${startBlock}, skipping...`);
        return;
      }
      
      // Stop if we've watched enough blocks
      if (currentBlock > startBlock + watchDuration) {
        console.log(`Watched ${watchDuration} blocks for copycats of ${originalTxHash.slice(0, 10)}`);
        clearInterval(checkInterval);
        return;
      }
      
      // Get recent transactions with error handling
      let block;
      try {
        block = await Promise.race([
          provider.getBlock(currentBlock, true), // Include transactions
          new Promise((_, reject) => setTimeout(() => reject(new Error('Block fetch timeout')), 8000))
        ]);
      } catch (blockError) {
        console.warn(`Failed to fetch block ${currentBlock}: ${blockError.message}`);
        return;
      }
      
      if (!block || !block.transactions || block.transactions.length === 0) {
        return;
      }
      
      // Process transactions in the block
      for (const txHash of block.transactions) {
        if (typeof txHash === 'string' && txHash === originalTxHash) continue;
        
        try {
          const tx = typeof txHash === 'string' ? 
            await provider.getTransaction(txHash) : 
            txHash; // In case full tx objects are returned
            
          if (!tx || !tx.to) continue;
          
          // Check if transaction is to any known DEX router
          const isDexTx = (
            tx.to.toLowerCase() === PRIMARY_ROUTER.toLowerCase() ||
            tx.to.toLowerCase() === FALLBACK_ROUTER.toLowerCase() ||
            tx.to.toLowerCase() === DEX_CONFIGS.UNISWAP_V3.SWAP_ROUTER.toLowerCase()
          );
          if (!isDexTx) continue;
          
          // Validate transaction value and prediction amount
          if (!tx.value || !prediction || !prediction.amount) continue;
          
          // Check if transaction data contains similar pattern
          const txValue = ethers.formatEther(tx.value);
          const originalValue = ethers.formatEther(prediction.amount);
          const txValueFloat = parseFloat(txValue);
          const originalValueFloat = parseFloat(originalValue);
          
          // Skip if values are invalid or zero
          if (isNaN(txValueFloat) || isNaN(originalValueFloat) || originalValueFloat === 0) continue;
          
          const valueDiff = Math.abs(txValueFloat - originalValueFloat);
          const percentDiff = valueDiff / originalValueFloat;
          
          // Copycat if within 20% of original value and to same router
          if (percentDiff < 0.2) {
            console.log(`COPYCAT DETECTED!`);
            console.log(`  Original: ${originalTxHash.slice(0, 10)} (${originalValue} ETH)`);
            console.log(`  Copycat: ${tx.hash.slice(0, 10)} (${txValue} ETH)`);
            console.log(`  From: ${tx.from.slice(0, 10)}...`);
            console.log(`  Block: ${currentBlock}`);
            
            // Track copycat
            if (!copycatTracker.has(originalTxHash)) {
              copycatTracker.set(originalTxHash, {
                count: 0,
                addresses: new Set(),
                timestamp: Date.now()
              });
            }
            
            const tracking = copycatTracker.get(originalTxHash);
            tracking.count++;
            tracking.addresses.add(tx.from);
            
            // Emit recursive signal if multiple copycats detected
            if (tracking.count >= 2 && !mirroredSignals.has(`RECURSIVE:${originalSignalHash}`)) {
              console.log(`Multiple copycats detected - emitting recursive belief signal...`);
              try {
                await emitRecursiveCopycatSignal(originalSignalHash, tracking);
              } catch (recursiveError) {
                console.error(`Failed to emit recursive signal: ${recursiveError.message}`);
              }
            }
          }
        } catch (txError) {
          // Skip invalid or problematic transactions silently
          if (txError.message.includes('timeout')) {
            console.warn(`Transaction fetch timeout, continuing...`);
          }
        }
      }
    } catch (intervalError) {
      console.error(`Copycat detection error: ${intervalError.message}`);
      // Don't clear interval on temporary errors, but limit retries
      if (intervalError.message.includes('invalid block range') || 
          intervalError.message.includes('block number timeout')) {
        console.warn(`Stopping copycat watching due to persistent RPC issues`);
        clearInterval(checkInterval);
      }
    }
  }, 3000); // Check every 3 seconds (increased from 2 to reduce RPC load)
  
  // Safety timeout to ensure interval is always cleared
  setTimeout(() => {
    clearInterval(checkInterval);
    console.log(`Safety timeout: Stopped watching for copycats of ${originalTxHash.slice(0, 10)}`);
  }, endTime - Date.now() + 5000); // Add 5 second buffer
}

// Enhanced recursive signal emission with phi-aligned depth and resonance
async function emitRecursiveCopycatSignal(parentHash, copycatData) {
  try {
// Enhanced phi-aligned recursive depth with resonance harmonics
    function calculatePhiDepth(copycatCount, uniqueAddresses, consensusMultiplier) {
      const PHI = 1.618033988749895;
      let depth = 1;
      
      // Base depth from copycat metrics with harmonic scaling
      depth += (copycatCount / 10) * PHI; // Primary phi scaling
      depth += (uniqueAddresses / 5) * Math.sqrt(PHI); // Secondary phi root scaling
      
      // Consensus amplification with recursive harmonics
      const harmonicFactor = consensusMultiplier > 2 ? PHI * PHI : PHI; // Squared phi for strong consensus
      depth *= (consensusMultiplier * harmonicFactor) / (PHI * PHI); // Normalized by phi squared
      
      // Apply fibonacci sequence boost for high copycat counts
      if (copycatCount >= 3) {
        depth *= 1.618033988749895; // Full precision phi multiplier
      }
      
      return Math.min(Math.floor(depth * PHI), 4); // Max depth of 4, final phi scaling
    }
    
    // Calculate resonance based on timing and depth
    const currentConsensusMultiplier = getConsensusMultiplier();
    const recursiveDepth = calculatePhiDepth(
      copycatData.count,
      copycatData.addresses.size,
      currentConsensusMultiplier
    );
    
    // Enhanced copycat-induced JAM with phi-alignment metrics
    const copycatJAM = {
      context: {
        source: "phi_aligned_copycat",
        observer: mirrorWallet.address,
        timestamp: Math.floor(Date.now() / 1000),
        parent: parentHash,
        phi_metrics: {
          window_distance: getMinDistanceToConsensusWindow(),
          consensus_multiplier: currentConsensusMultiplier,
          resonance: recursiveDepth * currentConsensusMultiplier
        }
      },
      pattern: {
        type: "recursive-belief",
        copycatCount: copycatData.count,
        uniqueCopycats: copycatData.addresses.size,
        inducedBy: parentHash.slice(0, 10),
        depth: recursiveDepth,
        alignment: "phi_harmonic",
        ipfs: '__IPFS_MANIFEST_HASH__',
      },
      belief: {
        confidence: Math.min(0.99, 0.8 + (copycatData.count * 0.05) * Math.sqrt(1.618)),
        strength: Math.min(0.99, 0.7 + (copycatData.addresses.size * 0.1) * 1.618),
        resonance: recursiveDepth * currentConsensusMultiplier,
        signalHash: ""
      },
      meta: {
        version: "0.3",
        notes: "Phi-aligned recursive signal",
        voice: DMAP_ADDRESS.slice(2, 10),
        phi_signature: "1.618033988749895"
      }
    };
    
const recursiveHash = ethers.keccak256(Buffer.from(JSON.stringify(copycatJAM)));
    copycatJAM.belief.signalHash = recursiveHash;
    
    // Emit the recursive signal
    const feeData = await provider.getFeeData();
    const tx = await vault.emitRecursiveSignal(recursiveHash, parentHash, {
      gasPrice: feeData.gasPrice,
      gasLimit: 150000
    });
    
    console.log(`RECURSIVE COPYCAT SIGNAL EMITTED!`);
    console.log(`  Hash: ${recursiveHash.slice(0, 10)}...`);
    console.log(`  Tx: ${tx.hash}`);
    console.log(`  Induced by ${copycatData.count} copycats from ${copycatData.addresses.size} unique addresses`);
    
    // Mark as processed
    mirroredSignals.add(`RECURSIVE:${parentHash}`);
    recursionDepth++;
    
  } catch (error) {
    console.error(`Failed to emit copycat signal: ${error.message}`);
  }
}

const copycatTracker = new Map(); // Track copycat activity

// Handle graceful shutdown
process.on('SIGINT', () => {
console.log(`\nFinal stats: ${totalMirrored} signals mirrored, ${ethers.formatEther(totalValueCreated)} ETH traded`);
  console.log(`Copycats detected: ${copycatTracker.size} patterns`);
  process.exit(0);
});

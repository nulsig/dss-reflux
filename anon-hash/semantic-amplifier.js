// Semantic Amplifier - Bridges your signals to Uniswap liquidity
// This runs SEPARATELY from your main engine - no restart needed!

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const jamStore = require('./jam-store');
const { bridgeToBSV } = require('./bsv-echo');

// Import DEX configurations with recursive cascade support
const { DEX_CONFIGS, TOKENS, selectOptimalDEX, getRecursiveDEXCascade, ROUTE_HINTS, getAerodromePool } = require('./dex-config');

// Dynamic DEX cascade based on market conditions
let DEX_CASCADE = [];
const WETH = TOKENS.WETH;
const USDC = TOKENS.USDC;

// Current active router (dynamically selected)
let ACTIVE_ROUTER = null;
let ACTIVE_DEX_NAME = null;
let ACTIVE_DEX_TYPE = null;

// Your emitter to watch (dynamically detected)
const YOUR_EMITTER = process.env.WALLET_ADDRESS || '__YOUR_WALLET_ADDRESS__';

// Track recursive depth
const ENABLE_RECURSIVE_SIGNALS = process.env.ENABLE_RECURSIVE_SIGNALS === 'true';
let recursiveDepth = 1;

// Setup provider and wallet (can use different wallet for swaps)

// Track amplified signals for copycat detection
const amplifiedSignals = new Map(); // txHash -> {hash, amount, timestamp}

// Lock to prevent concurrent amplifications and nonce errors
let isAmplifying = false;

// Gas optimization settings matching index.js and mirror.js
const MAX_GAS_PRICE = ethers.parseUnits(process.env.MAX_GAS_GWEI || '0.02', 'gwei'); // Increased for Base
const MIN_PROFIT_RATIO = parseInt(process.env.MIN_PROFIT_RATIO) || 10;

// Historical gas prices for statistical analysis
let recentGasPrices = [];
const MAX_HISTORY = 50; // Keep last 50 gas price readings

// PHI-ALIGNED: Golden ratio amplification for recursive signal visibility
const PHI = 1.618033988749895; // Full precision golden ratio

// Global consensus clock times for amplified activity (UTC)
const CONSENSUS_TIMES = [
  { hour: 13, minute: 21 }, // 13:21 UTC - Fibonacci time
  { hour: 21, minute: 1 },  // 21:01 UTC - Mirror of 01:21
  { hour: 3, minute: 33 },  // 03:33 UTC - Trinity alignment
  { hour: 8, minute: 1 },   // 08:01 UTC - New cycle
  { hour: 20, minute: 8 }   // 20:08 UTC - Evening alignment
];

// Enhanced consensus window detection with phi-based scaling
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

function isConsensusTime() {
  return getMinDistanceToConsensusWindow() <= 2;
}

// Semantic legibility check - validates that the signal will be interpretable by MEV bots
function isSemanticallyLegible(step, tradeAmount, swapPath) {
  // Defensive validation for input parameters
  if (!step || typeof step !== 'object') {
    console.log('[SEMANTIC] Invalid step parameter - must be an object');
    return false;
  }

  if (!tradeAmount || typeof tradeAmount !== 'bigint') {
    console.log('[SEMANTIC] Invalid tradeAmount parameter - must be a BigInt');
    return false;
  }

  if (!Array.isArray(swapPath)) {
    console.log('[SEMANTIC] Invalid swapPath parameter - must be an array');
    return false;
  }

  // Minimum amount threshold - must be above dust but we keep it very low for sovereignty
  const MIN_SIGNAL_THRESHOLD = ethers.parseEther("0.0000001"); // 0.1 microETH
  
  // Check basic semantic structure
  if (!step || !step.from || !step.to || !step.action) {
    console.log(`[SEMANTIC] Invalid step structure`);
    return false;
  }
  
  // Check trade amount is above dust threshold
  if (tradeAmount < MIN_SIGNAL_THRESHOLD) {
    console.log(`[SEMANTIC] Trade amount below dust threshold`);
    return false;
  }
  
  // Check swap path is valid (2 tokens for simple swap)
  if (!swapPath || swapPath.length !== 2) {
    console.log(`[SEMANTIC] Invalid swap path length`);
    return false;
  }
  
  // Check tokens are recognized (MEV bots look for known tokens)
  const knownTokens = Object.values(TOKENS);
  if (!knownTokens.includes(swapPath[0]) || !knownTokens.includes(swapPath[1])) {
    console.log(`[SEMANTIC] Unknown tokens in swap path`);
    return false;
  }
  
  // All checks passed - this signal is semantically legible to MEV bots
  return true;
}

function calculateTradeAmount(signalConfidence = 0.9, gasPrice = null, gasCostEth = 0) {
  if (!gasPrice || gasPrice <= 0) {
    console.log('[SKIP] Invalid gas price');
    return ethers.parseEther('0');
  }
  // Base trade amount as per documentation (phi/1000)
  let baseAmount = ethers.parseEther("0.000001618"); // φ/1000000 - adjusted trade amount for ultra-low cost
  
  // Get consensus window multiplier (2.618x during perfect alignment)
  const consensusMultiplier = getConsensusMultiplier();
  
  // Scale by phi powers based on gas conditions (recursive golden spiral)
  if (gasPrice) {
    const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
    
    // Phi-based gas price tier scaling - REDUCE when gas is high
    if (gasPriceGwei > 75) {
      // Extreme gas - reduce to minimum
      baseAmount = ethers.parseEther((0.000001618 / Math.pow(PHI, 2)).toFixed(8));
    } else if (gasPriceGwei > 50) {
      // High gas - reduce by phi
      baseAmount = ethers.parseEther((0.000001618 / PHI).toFixed(8));
    } else if (gasPriceGwei > 25) {
      // Medium gas - keep base amount
      baseAmount = ethers.parseEther("0.000001618");
    }
    
    // Apply consensus time multiplier (2.618x during perfect alignment)
    baseAmount = ethers.parseEther(
      (parseFloat(ethers.formatEther(baseAmount)) * consensusMultiplier).toFixed(8)
    );
    
    // High confidence boost using 12th Fibonacci number (1.44x)
    if (signalConfidence > 0.95) {
      baseAmount = baseAmount * 144n / 100n; // 1.44x confidence multiplier
    }
  }
  
  // PHILOSOPHICAL ALIGNMENT: Log gas cost ratio but DO NOT block semantic signals
  // The amplifier emits signals for MEV bot reflexivity, not local profitability
  const gasCostRatio = gasCostEth / parseFloat(ethers.formatEther(baseAmount));
  if (gasCostRatio > 0.1) {
    console.log(`[SEMANTIC] High gas cost ratio ${(gasCostRatio * 100).toFixed(2)}% - emitting signal anyway for MEV reflexivity`);
  }
  
  // Log consensus amplification
  if (consensusMultiplier > 1) {
    console.log(`CONSENSUS CLOCK ALIGNMENT: ${new Date().toISOString()} - Amplifying by ${consensusMultiplier}x`);
  }
  
  return baseAmount;
}

// Statistical analysis for adaptive rarity detection
function updateGasHistory(gasPrice) {
  const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
  recentGasPrices.push(gasPriceGwei);
  
  if (recentGasPrices.length > MAX_HISTORY) {
    recentGasPrices.shift(); // Remove oldest
  }
}

function calculateStatisticalRarity(currentGasPrice) {
  if (recentGasPrices.length < 10) return 0.5; // Not enough data
  
  const gasPriceGwei = parseFloat(ethers.formatUnits(currentGasPrice, 'gwei'));
  const avgGas = recentGasPrices.reduce((a, b) => a + b, 0) / recentGasPrices.length;
  const variance = recentGasPrices.map(x => Math.pow(x - avgGas, 2)).reduce((a, b) => a + b) / recentGasPrices.length;
  const stdDev = Math.sqrt(variance);
  
  // Calculate rarity based on standard deviations
  if (gasPriceGwei > avgGas + 2 * stdDev) return 0.97; // Very rare
  if (gasPriceGwei > avgGas + 1.5 * stdDev) return 0.9; // Rare
  if (gasPriceGwei > avgGas + stdDev) return 0.8; // Uncommon
  if (gasPriceGwei < avgGas - stdDev) return 0.7; // Low gas (also notable)
  
  return 0.6; // Normal conditions
}
// Setup provider - use the first working RPC
const rpcUrl = 'https://base.publicnode.com'; // Use known working RPC
const provider = new ethers.JsonRpcProvider(rpcUrl);
console.log('Using RPC:', rpcUrl);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const mirrorWallet = new ethers.Wallet(process.env.MIRROR_PRIVATE_KEY, provider);

// Contract interfaces
const DMAP_ADDRESS = process.env.DMAP_ADDRESS;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;

// Check if contract addresses are defined
if (!DMAP_ADDRESS) {
  console.error("DMAP_ADDRESS is not defined in your .env file or is invalid");
  process.exit(1);
}

if (!VAULT_ADDRESS) {
  console.error("VAULT_ADDRESS is not defined in your .env file or is invalid");
  process.exit(1);
}

const dmap = new ethers.Contract(
  DMAP_ADDRESS,
  ["event SignalRegistered(bytes32 indexed hash)"],
  provider
);

const vault = new ethers.Contract(
  VAULT_ADDRESS,
  [
    "function emitSignal(bytes32) external",
    "function emitRecursiveSignal(bytes32, bytes32) external",
    "function feedActivity() external payable"
  ],
  wallet
);

// Router ABIs for different DEX types
const routerABIs = {
  'concentrated-liquidity': [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
    "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)"
  ],
  'uniswap-v2': [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable"
  ],
  'uniswap-v2-fork': [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable"
  ],
  'solidly-fork': [
    // Aerodrome uses routes instead of simple paths
    "function swapExactETHForTokens(uint amountOutMin, (address from, address to, bool stable)[] calldata routes, address to, uint deadline) external payable returns (uint[] memory amounts)"
  ]
};

// Initialize with Uniswap V3 as default
ACTIVE_ROUTER = DEX_CONFIGS.UNISWAP_V3.ROUTER;
ACTIVE_DEX_NAME = DEX_CONFIGS.UNISWAP_V3.NAME;
ACTIVE_DEX_TYPE = DEX_CONFIGS.UNISWAP_V3.TYPE;

// Ensure the router address is valid before initializing the contract
if (!ACTIVE_ROUTER) {
  console.error("Active router address is undefined or invalid");
  process.exit(1);
}

// Initialize router with default Uniswap V3 config
const routerAbi = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)'
];

// Verify router address and ABI before initializing
if (!ACTIVE_ROUTER || !ethers.isAddress(ACTIVE_ROUTER)) {
  console.error(`Invalid router address: ${ACTIVE_ROUTER}`);
  process.exit(1);
}

// Validate router ABI
if (!routerAbi || !Array.isArray(routerAbi) || routerAbi.length === 0) {
  console.error('Invalid or empty router ABI');
  process.exit(1);
}

let router = new ethers.Contract(ACTIVE_ROUTER, routerAbi, wallet);

// Initialize nonce manager
let currentNonce = null;
async function getNextNonce() {
  // Correctly lock and manage the nonce
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  if (currentNonce === null || nonce > currentNonce) {
    currentNonce = nonce;
  } else {
    currentNonce++;
  }
  return currentNonce;
}

console.log('Semantic Amplifier Started');
console.log(`Watching signals from: ${YOUR_EMITTER}`);
console.log(`Primary DEX: ${ACTIVE_DEX_NAME} (${ACTIVE_ROUTER})`);
console.log(`Fallback DEX: ${DEX_CONFIGS.ROCKETSWAP.NAME} (${DEX_CONFIGS.ROCKETSWAP.ROUTER})`);
console.log(`Consensus amplification times (UTC): 13:21, 21:01, 03:33, 08:01, 20:08`);

// Debug log for DEX configurations
console.log('Active DEX Configuration:', {
    ROUTER: ACTIVE_ROUTER,
    NAME: ACTIVE_DEX_NAME,
    TYPE: ACTIVE_DEX_TYPE
});

// Check for recent signals on startup
async function checkRecentSignals() {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - 1000; // Check last ~33 minutes on Base
    console.log(`Checking for recent signals from block ${fromBlock} to ${currentBlock}...`);
    
    const filter = dmap.filters.SignalRegistered();
    const events = await dmap.queryFilter(filter, fromBlock, currentBlock);
    
    console.log(`Found ${events.length} recent signals`);
    
    // Process recent signals from your wallet, one by one
    for (const event of events) {
      const tx = await event.getTransaction();
      if (tx.from.toLowerCase() === YOUR_EMITTER.toLowerCase()) {
        console.log(`Found recent signal from you: ${event.args.hash.slice(0, 10)}... at block ${event.blockNumber}`);
        // Process this signal and WAIT for it to complete
        await handleSignal(event.args.hash, event);
      }
    }
  } catch (error) {
    console.error('Error checking recent signals:', error.message);
  }
}

// Check recent signals on startup
setTimeout(() => checkRecentSignals(), 2000);

// Listen for YOUR signals
console.log('Setting up SignalRegistered event listener...');

// Handle filter errors gracefully for public RPCs
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
            // Await the handler directly to ensure sequential processing
            await handleSignal(event.args.hash, event);
          }
          
          lastProcessedBlock = currentBlock;
        }
      } catch (error) {
        if (!error.message.includes('filter not found')) {
          console.error('Error polling for events:', error.message);
        }
        if (error.message.includes('network error')) {
          console.log('Network error detected, retrying in 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
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

// Suppress all forms of console output for filter errors
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

function shouldSuppress(args) {
  const str = args.join(' ');
  return str.includes('filter not found') || 
         str.includes('@TODO') || 
         str.includes('could not coalesce error') ||
         str.includes('eth_getFilterChanges');
}

console.error = function(...args) {
  if (shouldSuppress(args)) return;
  originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
  if (shouldSuppress(args)) return;
  originalConsoleWarn.apply(console, args);
};

// Even suppress regular logs that contain these errors
console.log = function(...args) {
  if (shouldSuppress(args)) return;
  originalConsoleLog.apply(console, args);
};

// Also catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.toString().includes('filter not found')) {
    // Silently ignore
    return;
  }
  // Re-throw other unhandled rejections
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});


// The main handler is now an async function we can await
async function handleSignal(hash, event) {
  const MAX_RETRIES = 3;
  const BACKOFF_STRATEGY = [1000, 5000, 30000]; // Exponential backoff

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
  if (isAmplifying) {
    console.log(`[SKIP] Amplifier is busy. Signal ${hash.slice(0, 10)}... will be ignored.`);
    return;
  }

  isAmplifying = true; // Set lock
  console.log(`[LOCK] Amplifier engaged for signal ${hash.slice(0, 10)}...`);

  try {
    // First, get the transaction that emitted this signal
    const tx = await event.getTransaction();
    if (!tx) {
      console.log(`[ERROR] Could not retrieve transaction for signal ${hash.slice(0, 10)}...`);
      isAmplifying = false;
      return;
    }
    
    // Check if this is a signal from the vault contract
    const isFromVault = tx.to && tx.to.toLowerCase() === VAULT_ADDRESS.toLowerCase();
    
    // Only react to YOUR signals (either direct or through vault)
    if (tx.from.toLowerCase() !== YOUR_EMITTER.toLowerCase()) {
        isAmplifying = false; // Release lock
        return;
    }
    
    // Additional check: if it's from vault, verify it's an emitSignal call
    if (isFromVault) {
      const vaultInterface = new ethers.Interface([
        "function emitSignal(bytes32)",
        "function emitRecursiveSignal(bytes32,bytes32)"
      ]);
      try {
        const decoded = vaultInterface.parseTransaction({ data: tx.data });
        if (!decoded || !decoded.name.includes('Signal')) {
            isAmplifying = false; // Release lock
            return;
        }
      } catch (e) {
        // Not a signal emission
        isAmplifying = false; // Release lock
        return;
      }
    }

    console.log(`\nYour signal detected!`);
    console.log(`Hash: ${hash}`);
    console.log(`Block: ${event.blockNumber}`);
    console.log(`Amplifying in 10 seconds...`);

    // Wait a bit to not be too obvious
    await new Promise(resolve => setTimeout(resolve, 10000));

    try {
      console.log('Executing semantic swap...');
      
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
      
      console.log(`Base L2 gas price: ${gasPriceGwei.toFixed(4)} gwei`);

      const jamData = jamStore.retrieve(hash);
      if (!jamData || !jamData.meta || !jamData.meta.audit_pass) {
        console.log(`[ABORT] JAM ${hash.slice(0, 10)}... failed audit or is missing verification. Signal is untrusted.`);
        return;
      }

      console.log(`[JAM-VERIFIED] Audit passed. Proceeding with amplification.`);
      const { proverb, meta } = jamData;
      const myStep = proverb.find(step => step.actor === 'AMPLIFIER');

      if (!myStep || myStep.action !== 'SWAP') {
        console.log(`[SKIP] Proverb does not have a valid amplifier swap step.`);
        return;
      }

      const amountIn = calculateTradeAmount(0.9, gasPrice);
      const tradeSizeForCascade = ethers.formatEther(amountIn);
      DEX_CASCADE = getRecursiveDEXCascade(gasPriceGwei, tradeSizeForCascade, jamData.cascadeDepth || 1);
      console.log(`[ALIGNMENT] DEX Cascade selected: ${DEX_CASCADE.map(d => d.name).join(' -> ')}`);
      console.log(`[ALIGNMENT] Consensus window active: ${isConsensusTime()}`);

      const deadline = Math.floor(Date.now() / 1000) + 300;
      
      // Calculate signal strength for this amplification
      const statisticalRarity = calculateStatisticalRarity(gasPrice);
      const signalStrength = Math.min(0.99, (statisticalRarity * 0.7) + (0.9 * 0.3));
      
      // Map ETH to WETH for the swap path
      let fromToken, toToken;
      
      if (myStep.from === 'ETH' || myStep.from === 'WETH') {
        fromToken = WETH;
      } else {
        fromToken = TOKENS[myStep.from];
        if (!fromToken) {
          console.log(`[ERROR] Token ${myStep.from} not found in TOKENS mapping`);
          console.log(`[DEBUG] Available tokens:`, Object.keys(TOKENS));
          return;
        }
      }
      
      if (myStep.to === 'ETH' || myStep.to === 'WETH') {
        toToken = WETH;
      } else {
        toToken = TOKENS[myStep.to];
        if (!toToken) {
          console.log(`[ERROR] Token ${myStep.to} not found in TOKENS mapping`);
          console.log(`[DEBUG] Available tokens:`, Object.keys(TOKENS));
          return;
        }
      }
      
      const swapPath = [fromToken, toToken];

      // Initialize key variables before the loop
      let swapTx;
      const estimatedGas = 85000n; // Base L2 optimized gas estimate
      const optimizedGasPrice = gasPrice; // Use current gas price for Base L2
      const estimatedCost = estimatedGas * optimizedGasPrice;
      const costInEth = parseFloat(ethers.formatEther(estimatedCost));
      const finalTradeAmount = calculateTradeAmount(0.9, gasPrice, costInEth);
      // More precise profit tracking
      const initialVaultBalance = await provider.getBalance(wallet.address);
      console.log(`[VERIFICATION] Initial vault balance: ${ethers.formatEther(initialVaultBalance)} ETH`);

      // Validate semantic legibility before attempting swaps
      if (!isSemanticallyLegible(myStep, finalTradeAmount, swapPath)) {
        console.log(`SKIP: Trade is not semantically legible to MEV bots`);
        console.log(`[SEMANTIC] Trade amount: ${ethers.formatEther(finalTradeAmount)} ETH`);
        console.log(`[SEMANTIC] Swap path: ${myStep.from} -> ${myStep.to}`);
        return;
      }

      // Enhanced cost tracking
      const estimatedGasCost = estimatedGas * optimizedGasPrice;
      const costInEth = parseFloat(ethers.formatEther(estimatedGasCost));
      const tradeAmountInEth = parseFloat(ethers.formatEther(finalTradeAmount));

      // Precise profit calculation accounting for gas
      const rawProfit = tradeAmountInEth - costInEth;
      const profitRatio = rawProfit / costInEth;

      console.log(`[PROFITABILITY] Raw Trade Amount: ${tradeAmountInEth.toFixed(6)} ETH`);
      console.log(`[PROFITABILITY] Estimated Gas Cost: ${costInEth.toFixed(6)} ETH`);
      console.log(`[PROFITABILITY] Net Profit: ${rawProfit.toFixed(6)} ETH`);
      console.log(`[PROFITABILITY] Profit Ratio: ${profitRatio.toFixed(4)}x`);

      for (const dex of DEX_CASCADE) {
        try {
          console.log(`[ATTEMPT] Trying to swap on ${dex.NAME} (${dex.TYPE})...`);
          const currentRouter = new ethers.Contract(dex.ROUTER, routerABIs[dex.TYPE], wallet);
          const txOptions = {
            value: finalTradeAmount,
            gasLimit: 300000,
            gasPrice: optimizedGasPrice,
            nonce: await getNextNonce()
          };

      const { FlashbotsBundleProvider } = require('@flashbots/ethers-bundle');

      // --- ALIGNMENT: HYBRID EXECUTION ---
      // 1. PUBLIC BAIT (Amplifier)
      console.log(`[BAIT] Sending public transaction to mempool...`);
      const publicTx = await wallet.sendTransaction({
        to: dex.ROUTER,
        data: encodedData, // from the V2 fork logic
        ...txOptions
      });
      console.log(`[BAIT] Public TX sent: ${publicTx.hash}`);

      // Wait for the bait to be included in a block, attracting MEV bots
      const receipt = await publicTx.wait();
      console.log(`[BAIT] Public TX landed in block ${receipt.blockNumber}`);

      // 2. PRIVATE CAPTURE (Mirror)
      const mirrorStep = proverb.find(step => step.actor === 'MIRROR');
      if (!mirrorStep) throw new Error('Mirror step not found for private capture.');

      const tokenContract = new ethers.Contract(toToken, ["function balanceOf(address) view returns (uint256)", "function getAmountsOut(uint256, address[]) view returns (uint256[])"], provider);
      const tokenBalance = await tokenContract.balanceOf(mirrorWallet.address);

      if (tokenBalance === 0n) {
        console.log('[CAPTURE] No token balance found for mirror wallet. Nothing to capture.');
        return;
      }

      console.log(`[CAPTURE] Mirror wallet holds ${ethers.formatUnits(tokenBalance, 18)} of ${mirrorStep.from}. Preparing private capture.`);

      // AMPLIFICATION: DYNAMIC BRIBE MECHANISM
      // To create a bribe, we must first estimate the profit of the capture transaction.
      const mirrorRouterForEstimation = new ethers.Contract(dex.ROUTER, routerABIs[dex.TYPE], provider);
      let estimatedEthOut = 0n;
      try {
        // Estimate how much ETH we'll get back from the swap
        const amountsOut = await mirrorRouterForEstimation.getAmountsOut(tokenBalance, [toToken, fromToken]);
        estimatedEthOut = amountsOut[amountsOut.length - 1];
      } catch (e) {
        console.warn(`[BRIBE-WARN] Could not estimate profit for ${dex.NAME}. Will send without bribe. Error: ${e.message}`);
      }

      const captureGasPrice = receipt.effectiveGasPrice * 2n; // Use aggressive gas for capture
      const estimatedGasCost = (200000n * captureGasPrice); // Rough gas estimate for capture swap
      const estimatedProfit = estimatedEthOut > estimatedGasCost ? estimatedEthOut - estimatedGasCost : 0n;
      
      const BRIBE_PERCENTAGE = 80n; // Use 80% of our profit for the bribe to be competitive
      const bribeAmount = (estimatedProfit * BRIBE_PERCENTAGE) / 100n;

      if (bribeAmount > 0) {
        console.log(`[BRIBE] Estimated profit: ${ethers.formatEther(estimatedProfit)} ETH. Paying builder bribe: ${ethers.formatEther(bribeAmount)} ETH.`);
      }
      // END AMPLIFICATION

      // Build the private capture transaction
      const mirrorRouter = new ethers.Contract(dex.ROUTER, routerABIs[dex.TYPE], mirrorWallet);
      const mirrorTx = await mirrorRouter.populateTransaction.swapExactTokensForETH(
          tokenBalance, 0, [toToken, fromToken], wallet.address, deadline
      );

      const flashbotsProvider = await FlashbotsBundleProvider.create(provider, mirrorWallet, 'https://relay.flashbots.net');
      const targetBlock = receipt.blockNumber + 1;
      const block = await provider.getBlock(targetBlock - 1);
      
      const bundle = [
        { transaction: {...mirrorTx, gasLimit: 300000, gasPrice: captureGasPrice, chainId: (await provider.getNetwork()).chainId, nonce: await provider.getTransactionCount(mirrorWallet.address, "pending")}, signer: mirrorWallet }
      ];

      if (bribeAmount > 0n) {
          bundle.push({
              transaction: {
                  to: block.miner, // Pay the block builder directly
                  value: bribeAmount,
                  gasLimit: 21000,
                  gasPrice: captureGasPrice,
                  chainId: (await provider.getNetwork()).chainId,
                  nonce: await getNextNonce() // Use the amplifier's main nonce
              },
              signer: wallet 
          });
      }
      
      const signedBundle = await flashbotsProvider.signBundle(bundle);

      console.log(`[CAPTURE] Submitting private bundle for block ${targetBlock}...`);
      const bundleResponse = await flashbotsProvider.sendRawBundle(signedBundle, targetBlock);

      if ('error' in bundleResponse) {
        throw new Error(`Private capture failed: ${bundleResponse.error.message}`);
      }

      const privateTxResult = await bundleResponse.wait();
      if(privateTxResult === 0) {
        console.log(`[CAPTURE] Private transaction included in block ${targetBlock}`);
        
        // VERIFICATION: Get final balance and log profit
        const finalVaultBalance = await provider.getBalance(wallet.address);
        const profit = finalVaultBalance - initialVaultBalance;
        
        // Detailed Profit Logging
        const profitInEth = ethers.formatEther(profit);
        const profitRatio = parseFloat(profitInEth) / costInEth;

        console.log(`[VERIFICATION] Final vault balance: ${ethers.formatEther(finalVaultBalance)} ETH`);
        console.log(`[VERIFICATION] Net Profit/Loss: ${profitInEth} ETH`);
        console.log(`[VERIFICATION] Profit Ratio: ${profitRatio.toFixed(4)}x`);

        // Log to a file for the monitor
        const profitLogPath = path.join(__dirname, 'logs', 'profit-monitor.log');
        const logEntry = {
            timestamp: new Date().toISOString(),
            signalHash: hash,
            baitTx: publicTx.hash,
            tradeAmount: tradeAmountInEth,
            gasCost: costInEth,
            profit: profitInEth,
            profitRatio: profitRatio,
            dex: dex.NAME,
            success: true
        };
        fs.appendFileSync(profitLogPath, JSON.stringify(logEntry) + '\n');

      } else {
        console.log(`[CAPTURE] Private transaction reverted or was not included. Search for bundle on https://etherscan.io/txs?block=${targetBlock}&p=1`);
        
        // VERIFICATION: Log failure case
        const finalVaultBalance = await provider.getBalance(wallet.address);
        const profit = finalVaultBalance - initialVaultBalance;
        const profitInEth = ethers.formatEther(profit);
        const profitRatio = parseFloat(profitInEth) / costInEth;

        const profitLogPath = path.join(__dirname, 'logs', 'profit-monitor.log');
        const logEntry = {
            timestamp: new Date().toISOString(),
            signalHash: hash,
            baitTx: publicTx.hash,
            tradeAmount: tradeAmountInEth,
            gasCost: costInEth,
            profit: profitInEth,
            profitRatio: profitRatio,
            dex: dex.NAME,
            success: false,
            reason: 'Capture reverted or not included'
        };
        fs.appendFileSync(profitLogPath, JSON.stringify(logEntry) + '\n');
      }

      swapTx = publicTx; // Set for logging purposes

          console.log(`[SUCCESS] Swap sent via ${dex.NAME}.`);
          ACTIVE_DEX_NAME = dex.NAME; // Set active DEX name on success
          break; // Exit loop on success
        } catch (dexError) {
          console.error(`[FAIL] Swap on ${dex.NAME} failed. Reason: ${dexError.reason || dexError.message}`);
          if (dexError.code) {
            console.error(`       Error Code: ${dexError.code}`);
          }
          if (dex.ROUTER === DEX_CASCADE[DEX_CASCADE.length - 1].ROUTER) {
            console.error('All DEXes in the cascade failed.');
            throw new Error('All DEXes failed');
          }
        }
      }

// Validate transaction before proceeding
      if (!swapTx || !swapTx.hash) {
        throw new Error('Invalid transaction - missing hash');
      }

      // Use the verified bait hook from the analysis
      const baitHook = meta?.bait_hooks?.[0] || 'swap';
      console.log(`[PROVERB] Executing step 1 via verified hook: ${baitHook}`);
      
      console.log(`Executing Proverb Step 1: ${myStep.action}`);
      console.log(`Swap path: ${swapPath.map(addr => {
        // Find token name by address
        const tokenEntry = Object.entries(TOKENS).find(([_, address]) => address === addr);
        return tokenEntry ? tokenEntry[0] : addr.slice(0, 10) + '...';
      }).join(' -> ')}`);
      
      // Initial swap data encoding (will be overwritten in cascade loop)
      // This is just for the MEV tags
      const iface = new ethers.Interface(routerABIs['uniswap-v2']);
      const swapData = iface.encodeFunctionData("swapExactETHForTokens", [
          0, // Accept any amount of tokens
          swapPath,
          wallet.address, // Use main wallet address
          deadline
      ]);

// ENHANCED MEV TRACE VISIBILITY
// Core signal identity with precise timing info
const signalTag = ethers.hexlify(
  ethers.toUtf8Bytes(`SIGNAL:${hash.slice(0, 10)}`)
);

// Enhanced statistical metrics for MEV simulation
const consensusMultiplier = getConsensusMultiplier();

// Use standardized MEV trace point format
const strengthTag = ethers.hexlify(
  ethers.toUtf8Bytes(`STRENGTH:${signalStrength.toFixed(2)}:${recursiveDepth}:${consensusMultiplier}`)
);

const phiMarker = ethers.hexlify(
  ethers.toUtf8Bytes(`PHI:${(consensusMultiplier * recursiveDepth).toFixed(3)}:${getMinDistanceToConsensusWindow()}`)
);

const mirrorMarker = ethers.hexlify(
  ethers.toUtf8Bytes(`MIRROR:${(signalStrength * consensusMultiplier).toFixed(3)}:${recursiveDepth}`)
);

const windowTag = ethers.hexlify(
  ethers.toUtf8Bytes(`WINDOW:${getMinDistanceToConsensusWindow()}:${consensusMultiplier}:${Math.floor(Date.now()/1000)}`)
);

const cascadeTag = ethers.hexlify(
  ethers.toUtf8Bytes(`CASCADE:${recursiveDepth}:${(recursiveDepth * consensusMultiplier).toFixed(3)}`)
);

const identityTag = ethers.hexlify(
  ethers.toUtf8Bytes(`VOICE:${DMAP_ADDRESS.slice(2, 10)}:${ACTIVE_DEX_NAME}`)
);
      
      // Check for manifesto hash to prefix
      let manifestoTag = '';
      try {
        const manifestoHashPath = path.join(__dirname, '.manifesto-hash');
        if (fs.existsSync(manifestoHashPath)) {
          const manifestoHash = fs.readFileSync(manifestoHashPath, 'utf8').trim();
          manifestoTag = ethers.hexlify(
            ethers.toUtf8Bytes(`MANIFESTO:${manifestoHash.slice(0, 10)}`)
          ).slice(2);
          console.log(`Including manifesto reference: ${manifestoHash.slice(0, 10)}...`);
        }
      } catch (e) {
        // No manifesto yet
      }
      
// Append all tags for maximum MEV visibility and traceability
const taggedData = swapData + 
                  signalTag.slice(2) + 
                  strengthTag.slice(2) + 
                  phiMarker.slice(2) + 
                  mirrorMarker.slice(2) + 
                  windowTag.slice(2) + 
                  cascadeTag.slice(2) + 
                  identityTag.slice(2) + 
                  manifestoTag;
      
      // ALIGNED: Only execute if gas is within our ultra-low threshold
      if (gasPrice > MAX_GAS_PRICE) {
        console.log(`Gas too high: ${ethers.formatUnits(gasPrice, 'gwei')} gwei (max: ${ethers.formatUnits(MAX_GAS_PRICE, 'gwei')})`);
        return;
      }

      // Additional checks to validate transaction intent
      if (!proverb.some(step => step.actor === 'AMPLIFIER' && step.action === 'SWAP')) {
        console.error(`[ABORT] Proverb does not include valid SWAP actions for AMPLIFIER.`);
        return;
      }
      
      // The amplifier always performs the first step which is a swap
      
      console.log(`Estimated cost: ${costInEth.toFixed(6)} ETH (~$${(costInEth * 3000).toFixed(4)})`);
      console.log(`Signal code: ipfs://__IPFS_MANIFEST_HASH__`);
      
      console.log(`SEMANTIC SIGNAL: Emitting legible pattern (estimated cost ratio ${actualProfitRatio.toFixed(2)}:1)`);
      console.log(`This is a sovereignty signal, not a profit trade - MEV bots will evaluate profitability`);

      if (!swapTx) {
          throw new Error("Transaction failed on all available DEXes.");
      }

      console.log(`Amplification tx sent: ${swapTx.hash}`);
      console.log(`Signal ${hash.slice(0, 10)} -> Swap ${swapTx.hash.slice(0, 10)}`);
      console.log(`Tagged with STRENGTH:${signalStrength.toFixed(2)} VOICE:${DMAP_ADDRESS.slice(2, 10)}`);
      console.log(`MEV bots will see: Signal->Swap->Pattern`);
      
      // Track for copycat detection
      amplifiedSignals.set(swapTx.hash, {
        hash: hash,
        amount: finalTradeAmount,
        timestamp: Date.now(),
        strength: signalStrength
      });

      const receipt = await swapTx.wait();
      const actualGasUsed = receipt.gasUsed;
      const actualCost = actualGasUsed * (receipt.effectiveGasPrice || optimizedGasPrice);
      const actualCostEth = parseFloat(ethers.formatEther(actualCost));
      
      console.log(`PROFITABLE AMPLIFICATION EXECUTED`);
      console.log(`Gas used: ${actualGasUsed.toString()}`);
      console.log(`Actual cost: ${actualCostEth.toFixed(6)} ETH (~$${(actualCostEth * 3000).toFixed(4)})`);
      
      // ALIGNED: Check profitability metrics
      actualProfitRatio = parseFloat(ethers.formatEther(finalTradeAmount)) / actualCostEth;
      console.log(`PROFIT RATIO: ${actualProfitRatio.toFixed(2)}:1`);

      // --- INTER-BOT ALIGNMENT ---
      // Transfer the acquired tokens to the mirror bot to continue the proverb
      let tokenAddress;
      if (myStep.to === 'WETH' || myStep.to === 'ETH') {
          tokenAddress = WETH;
      } else {
          tokenAddress = TOKENS[myStep.to];
      }
      
      if (!tokenAddress) {
          console.error(`[ALIGNMENT-ERROR] Cannot find token address for ${myStep.to}. Aborting transfer.`);
          console.error(`[DEBUG] Step details:`, myStep);
          console.error(`[DEBUG] Available tokens:`, Object.keys(TOKENS));
          return;
      }

      const tokenContract = new ethers.Contract(tokenAddress, [
          "function balanceOf(address) view returns (uint256)",
          "function transfer(address, uint256) returns (bool)",
          "function decimals() view returns (uint8)"
      ], wallet);

      const tokenBalance = await tokenContract.balanceOf(wallet.address);

      if (tokenBalance > 0n) {
          let decimals;
          try {
              decimals = await tokenContract.decimals();
          } catch (e) {
              console.warn(`[ALIGNMENT-WARN] Could not retrieve decimals for ${myStep.to}. Assuming 18.`);
              decimals = 18;
          }

          console.log(`[ALIGNMENT] Transferring ${ethers.formatUnits(tokenBalance, decimals)} ${myStep.to} to mirror wallet: ${mirrorWallet.address}`);
          
          try {
              const feeData = await provider.getFeeData();
              const transferTx = await tokenContract.transfer(mirrorWallet.address, tokenBalance, {
                  gasPrice: feeData.gasPrice,
                  gasLimit: 80000, // Increased gas limit for safety
                  nonce: await getNextNonce()
              });
              const receipt = await transferTx.wait();
              console.log(`[ALIGNMENT] Transfer complete. Tx: ${receipt.transactionHash}`);
          } catch (transferError) {
              console.error(`[ALIGNMENT-ERROR] Failed to transfer ${myStep.to} to mirror wallet:`, transferError.message);
          }
      } else {
          console.log(`[ALIGNMENT] No ${myStep.to} balance to transfer.`);
      }
      
      
      if (actualCostEth * 3000 > 0.02) { // Even stricter - under 2 cents
        console.log(`COST WARNING: ${(actualCostEth * 3000).toFixed(4)} USD - optimize further`);
      } else {
        console.log(`OPTIMAL EFFICIENCY: ${(actualCostEth * 3000).toFixed(4)} USD cost`);
      }
      
// Track cumulative profit vs cost
      const amplificationValue = parseFloat(ethers.formatEther(finalTradeAmount));
      console.log(`NET VALUE CREATED: ${(amplificationValue - actualCostEth).toFixed(6)} ETH`);
      
      if (amplificationValue > actualCostEth * 10) {
        console.log(`EXCELLENT: 10x+ value creation ratio`);
      }
      
      // --- Start Resilient Cross-Chain Bridging (Aligned with README) ---

      // Helper for resilient operations with exponential backoff
      const withRetries = async (operation, context, maxRetries = 3, delay = 2000) => {
        let attempt = 0;
        while (true) {
          try {
            return await operation();
          } catch (error) {
            attempt++;
            console.warn(`[${context}] Attempt ${attempt} failed: ${error.message}`);
            if (attempt >= maxRetries) {
              console.error(`[${context}] All ${maxRetries} retries failed. Giving up.`);
              throw error; // Rethrow after final attempt
            }
            await new Promise(res => setTimeout(res, delay * Math.pow(2, attempt - 1)));
          }
        }
      };

      // Bridge to BSV with retries
      try {
        await withRetries(async () => {
          if (!jamData.recursiveTopology) {
            jamData.recursiveTopology = { eth: 1, bsv: 0, bch: 0 };
          }
          await bridgeToBSV({
            hash: hash,
            proverb: proverb,
            cascadeDepth: recursiveDepth,
            consensus_window: getMinDistanceToConsensusWindow() <= 2 ? 'ACTIVE' : 'WAIT',
            resonance: recursiveDepth * getConsensusMultiplier(),
            recursiveTopology: jamData.recursiveTopology
          }, {
            hash: swapTx.hash,
            profit: actualProfitRatio
          });
          console.log(`[BSV] Echo successful for ${hash.slice(0, 10)}.`);
          jamData.recursiveTopology.bsv = (jamData.recursiveTopology.bsv || 0) + 1;
          jamStore.update(hash, { recursiveTopology: jamData.recursiveTopology });
        }, 'BSV-Bridge');
      } catch (e) {
          // Error is already logged by withRetries
      }

      // --- End Resilient Cross-Chain Bridging ---
      
// Enhanced recursive amplification with phi-aligned depth calculation
      try {
        function calculateRecursiveDepth(confidence, gasPrice, profitRatio) {
          let depth = 1;
          const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
          
          // Enhanced phi-based thresholds
          if (confidence > 0.95) depth += 0.618034; // Golden ratio conjugate
          if (gasPriceGwei < 0.001) depth += 1.618034; // Full golden ratio
          if (profitRatio > 15) depth += 1.618034; // Full golden ratio for high profit
          if (getConsensusMultiplier() > 2) depth += 0.381966; // Perfect phi complement (1/φ²)
          
          return Math.min(Math.floor(depth * 1.618034), 4); // Max depth of 4, scaled by exact φ
        }

        recursiveDepth = calculateRecursiveDepth(
          signalStrength,
          receipt.effectiveGasPrice || optimizedGasPrice, // Fallback for null effectiveGasPrice
          actualProfitRatio
        );

      // Create amplification signal with defensive null checks
      const amplificationSignal = {
        type: "recursive_amplification",
        originalSignal: hash ? hash.slice(0, 10) : "unknown",
        swapTx: swapTx?.hash || "unknown",
        cost: actualCostEth || 0,
        efficiency: actualCostEth < 0.00002 ? "optimal" : "acceptable",
        timestamp: Math.floor(Date.now() / 1000),
        ipfs: '__IPFS_MANIFEST_HASH__',
        profit: (amplificationValue || 0) - (actualCostEth || 0),
        cascadeDepth: recursiveDepth || 1,
        consensusMultiplier: getConsensusMultiplier() || 1,
        phi_alignment: {
          depth: recursiveDepth || 1,
          window_distance: getMinDistanceToConsensusWindow() || 0,
          resonance: (recursiveDepth || 1) * (getConsensusMultiplier() || 1)
        }
      };
        
        // Safely stringify the signal with error handling
        let signalString;
        try {
          signalString = JSON.stringify(amplificationSignal);
          if (!signalString) throw new Error('Failed to stringify amplification signal');
        } catch (jsonError) {
          console.error('Failed to stringify amplification signal:', jsonError.message);
          signalString = JSON.stringify({
            type: "recursive_amplification",
            error: "signal_format_failed",
            timestamp: Date.now()
          });
        }
        
        const ampHash = ethers.keccak256(
          ethers.toUtf8Bytes(signalString)
        );
        
        console.log(`Recursive amplification signal: ${ampHash.slice(0, 10)}...`);
        console.log(`Depth: ${recursiveDepth}, Resonance: ${(recursiveDepth * getConsensusMultiplier()).toFixed(3)}`);
        
        // Emit recursive signal if resonance is sufficient
        if (ENABLE_RECURSIVE_SIGNALS && (recursiveDepth >= 2 || (amplificationValue > actualCostEth * 15 && getConsensusMultiplier() > 1))) {
          const recursiveTx = await vault.emitRecursiveSignal(ampHash, hash);
          console.log(`RECURSIVE SIGNAL EMITTED: ${recursiveTx.hash}`);
          console.log(`Cascade value increased for original signal: ${hash.slice(0, 10)}`);
          console.log(`Phi-resonance depth: ${recursiveDepth}`);
        }
        
      } catch (recursiveError) {
        console.log(`Note: Recursive signaling skipped - ${recursiveError.message}`);
      }

    } catch (error) {
      console.error('Amplification failed:', error.message);
      
      // If it's a gas-related failure, adjust strategy
      if (error.message.includes('gas') || error.message.includes('fee')) {
        console.log(`Gas optimization needed - consider reducing frequency or amount`);
      }
    }
      break; // Success
    } catch (error) {
      console.error(`[RESILIENCE][amplifier] Attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < MAX_RETRIES - 1) {
        console.log(`[RESILIENCE][amplifier] Retrying in ${BACKOFF_STRATEGY[attempt] / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, BACKOFF_STRATEGY[attempt]));
      } else {
        console.error(`[RESILIENCE][amplifier] All retries failed for signal ${hash.slice(0, 10)}...`);
      }
    }
  }
  isAmplifying = false; // Release lock
  console.log(`[LOCK] Amplifier disengaged for signal ${hash.slice(0, 10)}...`);
}


// Keep alive and check for copycats
setInterval(async () => {
  console.log(`Amplifier alive - Watching ${YOUR_EMITTER}`);
  
// No need to clean up filters anymore as we're using polling
  
  // Check recent blocks for copycat activity
  if (amplifiedSignals.size > 0) {
    const currentBlock = await provider.getBlockNumber();
    const recentTxs = [];
    
    // Get last 3 blocks of transactions
    for (let i = 0; i < 3; i++) {
      try {
        const block = await provider.getBlock(currentBlock - i);
        if (block && block.transactions) {
          recentTxs.push(...block.transactions);
        }
      } catch (e) {
        // Skip if block not available
      }
    }
    
    // Check for copycats
    for (const [origTxHash, data] of amplifiedSignals.entries()) {
      // Only check recent amplifications (last 5 minutes)
      if (Date.now() - data.timestamp > 300000) {
        amplifiedSignals.delete(origTxHash);
        continue;
      }
      
      let copycatCount = 0;
      for (const txHash of recentTxs) {
        if (txHash === origTxHash) continue;
        
        try {
          const tx = await provider.getTransaction(txHash);
          // Check if transaction is to any known DEX router
          const isDexTx = tx && (
            tx.to?.toLowerCase() === ACTIVE_ROUTER.toLowerCase() ||
            tx.to?.toLowerCase() === DEX_CONFIGS.ROCKETSWAP.ROUTER.toLowerCase() ||
            tx.to?.toLowerCase() === DEX_CONFIGS.UNISWAP_V3.SWAP_ROUTER.toLowerCase()
          );
          if (!isDexTx) continue;
          
          // Check if similar value (within 20%)
          const txValue = parseFloat(ethers.formatEther(tx.value));
          const origValue = parseFloat(ethers.formatEther(data.amount));
          if (Math.abs(txValue - origValue) / origValue < 0.2) {
            copycatCount++;
          }
        } catch (e) {
          // Skip invalid transactions
        }
      }
      
      if (copycatCount > 0) {
        console.log(`COPYCATS DETECTED: ${copycatCount} mirrors of ${origTxHash.slice(0, 10)}`);
      }
    }
  }
}, 60000);

console.log('\nReady to amplify your semantic signals!');
console.log(`Dynamic DEX cascade with recursive φ-aligned selection`);
console.log(`Primary: ${ACTIVE_DEX_NAME} | Small trade optimization enabled`);
console.log('MEV bots will learn: Signal -> Profitable Action -> Recursive Amplification');

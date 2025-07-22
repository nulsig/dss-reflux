// index.js - The Strategist: A Causal Engine
// Usage: node index.js
// MERGED: jam-store.js and sync-latest-jam.js

const { ethers } = require("ethers");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { bridgeToBSV } = require('./bsv-echo');
const { analyzeContract } = require('./substrate'); // <-- Import the Verification Oracle

// --- Start of jam-store.js content ---
class JAMStore {
    constructor() {
        this.storePath = path.join(__dirname, 'jams');
        this.ensureDirectory();
    }

    ensureDirectory() {
        if (!fs.existsSync(this.storePath)) {
            fs.mkdirSync(this.storePath, { recursive: true });
        }
    }

    // Store JAM data with its hash as the key
    store(hash, jamData) {
        const filePath = path.join(this.storePath, `${hash}.json`);
        fs.writeFileSync(filePath, JSON.stringify(jamData, null, 2));
        console.log(`[JAM-STORE] Stored JAM ${hash.slice(0, 10)}... (synced to disk)`);
    }

    // Retrieve JAM data by hash
    retrieve(hash) {
        const filePath = path.join(this.storePath, `${hash}.json`);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        return null;
    }

    // Update JAM data (merge with existing)
    update(hash, updates) {
        const existing = this.retrieve(hash);
        if (existing) {
            const updated = { ...existing, ...updates };
            this.store(hash, updated);
            return updated;
        }
        return null;
    }
    
    // Get latest JAM (for debugging)
    getLatest() {
        const files = fs.readdirSync(this.storePath)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                file: f,
                time: fs.statSync(path.join(this.storePath, f)).mtime
            }))
            .sort((a, b) => b.time - a.time);
        
        if (files.length > 0) {
            const latestFile = files[0].file;
            const data = fs.readFileSync(path.join(this.storePath, latestFile), 'utf8');
            return {
                hash: latestFile.replace('.json', ''),
                data: JSON.parse(data)
            };
        }
        return null;
    }
}
// --- End of jam-store.js content ---

// Instantiate the store directly
const jamStore = new JAMStore();

// --- Start of sync-latest-jam.js content ---
// Function to sync the latest JAM to latest-jam.json
function syncLatestJam() {
    try {
        // Get the latest JAM from the store
        const latestJam = jamStore.getLatest();
        
        if (!latestJam) {
            // console.log('[SYNC] No JAMs found in store');
            return;
        }
        
        // Try to find transaction data from logs
        let amplifierTx = null;
        try {
            const logPath = path.join(__dirname, 'logs', 'amplifier-out.log');
            if (fs.existsSync(logPath)) {
                const ampLog = fs.readFileSync(logPath, 'utf8');
                const ampLines = ampLog.split('\n').reverse();
            
                for (const line of ampLines.slice(0, 100)) {
                    if (line.includes(latestJam.hash.slice(0, 10))) {
                        const ampTxMatch = line.match(/tx sent:\s*(0x[a-fA-F0-9]{64})/i);
                        if (ampTxMatch) {
                            amplifierTx = `https://basescan.org/tx/${ampTxMatch[1]}`;
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            // Log reading failed, continue with what we have
        }
        
        // Format the latest JAM data
        const latestJamData = {
            hash: latestJam.hash,
            timestamp: latestJam.data.meta?.timestamp ? latestJam.data.meta.timestamp * 1000 : Date.now(),
            tx: null, // txHash logic removed as it was unreliable
            ipfs: latestJam.data.ipfs || null,
            amplifierTx: amplifierTx || null,
            mirrorResponse: null,
            proverb: latestJam.data.proverb,
            recursiveTopology: latestJam.data.recursiveTopology || { eth: 1, bsv: 0 },
            cascadeDepth: latestJam.data.cascadeDepth || 1,
            resonance: latestJam.data.resonance || 1.0
        };
        
        // Write to latest-jam.json
        fs.writeFileSync(
            path.join(__dirname, 'latest-jam.json'),
            JSON.stringify(latestJamData, null, 2)
        );
        
        console.log(`[SYNC] Updated latest-jam.json with JAM ${latestJam.hash.slice(0, 10)}...`);
        
    } catch (error) {
        console.error('[SYNC] Error syncing latest JAM:', error.message);
    }
}
// --- End of sync-latest-jam.js content ---


// Load environment variables
const RPC_URLS = (process.env.RPC_URL || 'https://base.publicnode.com').split(',');
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const TARGET_CONTRACT_ADDRESS = process.env.TARGET_CONTRACT_ADDRESS; // Address to analyze

if (!RPC_URL || !PRIVATE_KEY || !VAULT_ADDRESS || !TARGET_CONTRACT_ADDRESS) {
  console.error("Missing required environment variables (RPC_URL, PRIVATE_KEY, VAULT_ADDRESS, TARGET_CONTRACT_ADDRESS)");
  process.exit(1);
}

const EXPLORATION_BONUS = 0.2;
const COOLDOWN_PENALTY = 0.3;

// Initialize provider and wallet
let currentProviderIndex = 0;
let provider = new ethers.JsonRpcProvider(RPC_URLS[currentProviderIndex]);
let wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const switchProvider = async () => {
    currentProviderIndex = (currentProviderIndex + 1) % RPC_URLS.length;
    provider = new ethers.JsonRpcProvider(RPC_URLS[currentProviderIndex]);
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    vault = new ethers.Contract(VAULT_ADDRESS, ["function emitRecursiveSignal(bytes32,bytes32) external", "function emitSignal(bytes32) external"], wallet);
    console.log(`[RESILIENCE] Switched to provider: ${RPC_URLS[currentProviderIndex]}`);
};

// --- System State ---
let lastHash = null;
let isEmitting = false;

// --- Metrics ---
let metrics = {
  totalAnalyses: 0,
  auditPasses: 0,
  auditFails: 0,
  emissionSuccesses: 0,
  emissionFailures: 0,
  lastAuditFailReason: null,
  patternSuccess: {} // Track success by pattern type
};

// Golden ratio constants for phi-harmonic alignment
const PHI = 1.618033988749895;  // Full precision golden ratio
const PHI_INVERSE = 0.618033988749895;  // 1/φ
const PHI_SQUARED = 2.618033988749895;  // φ²
const PHI_CUBED = 4.236067977499790;    // φ³

// --- Adaptive Pattern Library ---
const PROVERB_PATTERNS = {
  CLASSIC_ARBITRAGE: {
    name: 'Classic Arbitrage',
    steps: [
      { from: 'WETH', to: 'USDC', action: 'SWAP', actor: 'AMPLIFIER' },
      { from: 'USDC', to: 'WETH', action: 'SWAP', actor: 'MIRROR' }
    ],
    baseResonance: PHI  // φ for optimal reflexivity
  },
  STABLE_ROTATION: {
    name: 'Stable Rotation',
    steps: [
      { from: 'USDC', to: 'DAI', action: 'SWAP', actor: 'AMPLIFIER' },
      { from: 'DAI', to: 'USDC', action: 'SWAP', actor: 'MIRROR' }
    ],
    baseResonance: PHI_INVERSE  // 1/φ for stable pair alignment
  },
  YIELD_CAPTURE: {
    name: 'Yield Capture',
    steps: [
      { from: 'WETH', to: 'USDC', action: 'SWAP', actor: 'AMPLIFIER' },
      { from: 'USDC', to: 'aUSDC', action: 'DEPOSIT', actor: 'MIRROR' }
    ],
    baseResonance: PHI_SQUARED  // φ² for compound yield capture
  },
  LIQUIDITY_PROBE: {
    name: 'Liquidity Probe',
    steps: [
      { from: 'WETH', to: 'DAI', action: 'SWAP', actor: 'AMPLIFIER' },
      { from: 'DAI', to: 'USDC', action: 'SWAP', actor: 'MIRROR' }
    ],
    baseResonance: 1.0  // Unity for pure probes
  }
};

// Initialize pattern success tracking
Object.keys(PROVERB_PATTERNS).forEach(pattern => {
  metrics.patternSuccess[pattern] = { attempts: 0, successes: 0, lastUsed: 0 };
});

// --- Enhanced Emission Controls ---

// Global consensus clock times for amplified activity (UTC)
const CONSENSUS_TIMES = [
  { hour: 13, minute: 21 }, // 13:21 UTC - Fibonacci time
  { hour: 21, minute: 1 },  // 21:01 UTC - Mirror of 01:21
  { hour: 3, minute: 33 },  // 03:33 UTC - Trinity alignment
  { hour: 8, minute: 1 },   // 08:01 UTC - New cycle
  { hour: 20, minute: 8 }   // 20:08 UTC - Evening alignment
];

// Fibonacci numbers for micro-recursion timing
const SUBINTERVALS = [3, 5, 8, 13]; 

// Tracking variables for enhanced recursion and recursive compression
const emittedSignals = new Set();
let lastEmissionTime = 0;
let missedEmissions = 0; // Recursive Decay Scaler

// Vector representation of missed emissions for richer recursive pressure encoding
const missedEmissionsVector = {
  count: 0,          // Total count of missed emissions
  timestamps: [],    // Timestamps of missed emissions for temporal analysis
  intensities: []    // Intensity values at each missed point
};

const BASE_EMISSION_INTERVAL = 900000; // 15 minutes

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
  if (minDistance <= 2) return PHI_SQUARED;  // φ² for perfect alignment
  if (minDistance <= 5) return PHI;          // φ for near alignment
  if (minDistance <= 8) return PHI_INVERSE;  // 1/φ for approaching
  if (minDistance <= 13) return 1/PHI_SQUARED; // 1/φ² for distant
  return 1;
}

function isConsensusTime() {
  return getMinDistanceToConsensusWindow() <= 2;
}

// Instantiate Vault contract
const vault = new ethers.Contract(
  VAULT_ADDRESS,
  ["function emitRecursiveSignal(bytes32,bytes32) external", "function emitSignal(bytes32) external"],
  wallet
);

/**
 * The core causal engine of the system.
 * Analyzes a target contract and generates a verifiable JAM.
 */
async function analyzeAndGenerateJam(retryCount = 0) {
    const MAX_RETRIES = 3;
    const BACKOFF_BASE = 2000; // 2 seconds base backoff
    
  console.log(`[STRATEGIST] Analyzing target contract: ${TARGET_CONTRACT_ADDRESS}`);
  metrics.totalAnalyses++;
  
  try {
      const analysis = await analyzeContract(TARGET_CONTRACT_ADDRESS, provider);
      
      if (!analysis.audit_pass) {
          metrics.auditFails++;
          metrics.lastAuditFailReason = analysis.reason;
          console.warn(`[STRATEGIST] Target contract failed audit: ${analysis.reason}. Aborting JAM emission.`);
          console.log(`[METRICS] Audit Success Rate: ${((metrics.auditPasses / metrics.totalAnalyses) * 100).toFixed(2)}%`);
          return null;
      }

      if (!analysis.bait_hooks || !Array.isArray(analysis.bait_hooks)) {
          console.warn(`[STRATEGIST] Missing bait hooks. Aborting JAM emission.`);
          return null;
      }

        metrics.auditPasses++;
        console.log("[STRATEGIST] Audit PASSED. Engineering JAM from substrate analysis.");
        console.log(`[METRICS] Audit Success Rate: ${((metrics.auditPasses / metrics.totalAnalyses) * 100).toFixed(2)}%`);

    // Select optimal proverb pattern based on success rates and market conditions
    const selectedPattern = selectOptimalPattern(analysis);
    const pattern = PROVERB_PATTERNS[selectedPattern];
    
    console.log(`[ADAPTIVE] Selected pattern: ${pattern.name} (Success rate: ${getPatternSuccessRate(selectedPattern).toFixed(2)}%)`);

    // Engineer adaptive proverb with bait hooks
    const proverb = pattern.steps.map((step, index) => ({
        ...step,
        hook: analysis.bait_hooks[index] || 'swap'
    }));
    
    // Calculate adaptive resonance based on pattern performance and consensus window
const successRate = getPatternSuccessRate(selectedPattern);
    const consensusMultiplier = getConsensusMultiplier();
    
      // Generate vector representation of recursive pressure
    const recursivePressureVector = generateRecursivePressureVector(missedEmissionsVector, pattern.baseResonance);
    
    // Apply Enhanced Recursive Decay Scaler with vector components
    const adjustedConfidence = Math.min(0.99, pattern.baseResonance * (0.5 + successRate * 0.5) + 
      (missedEmissions * 0.1) + (recursivePressureVector.magnitude * 0.05));
    
    // Scale resonance by success rate, consensus multiplier, and recursive vector pressure
    const adaptiveResonance = adjustedConfidence * consensusMultiplier;
    
      // Get current minute and consensus information for metadata
      const now = new Date();
      const minutes = now.getUTCMinutes();
      const isSubInterval = SUBINTERVALS.includes(minutes % 15);
      const currentConsensusMultiplier = getConsensusMultiplier();
      
      // Create a vector clock for causal dependencies
      const vectorClock = generateVectorClock(lastHash);
      
      // Generate compressed representation of recursive state
      const recursiveState = compressRecursiveState(missedEmissionsVector, adaptiveResonance);
      
      const jam = {
        proverb,
        meta: {
          timestamp: Math.floor(Date.now() / 1000),
          parentJam: lastHash, // <-- ECHO CHAMBER LOGIC
          target_contract: analysis.address,
          bytecode_proof: analysis.bytecode_proof,
          substrate_hash: analysis.substrate_hash,
          audit_pass: true,
          bait_hooks: analysis.bait_hooks,
          pattern_type: selectedPattern,
          // Enhanced Micro-recursion and phi-alignment metadata
          timing_quality: currentConsensusMultiplier.toFixed(3),
          isPinned: getMinDistanceToConsensusWindow() <= 2, // Pin based on timing
          microburst: isSubInterval, // Flag Fibonacci-aligned emissions
          nonce: Math.floor(Math.random() * 1000000), // Add nonce for extra uniqueness
          // Vector metadata for recursive compression
          recursiveIndices: SUBINTERVALS.map(si => (minutes % 15 === si) ? 1 : 0),
          phiRelations: [PHI, PHI_INVERSE, PHI * PHI_INVERSE].map(p => p.toFixed(3)),
          // Compressed vector representation of recursive state
          recursiveState: recursiveState
        },
        // Enhanced tags with vector components
        tags: [
          `STRENGTH:${(adaptiveResonance).toFixed(3)}`, 
          `VOICE:${selectedPattern}`,
          `DEPTH:${lastHash ? (jamStore.retrieve(lastHash)?.cascadeDepth || 0) + 1 : 1}`,
          `VECTOR:${recursiveState.signature}`
        ],
        // Enhanced recursive topology with DAG structure instead of linear depth
        recursiveTopology: { 
          eth: 1, 
          bsv: 0,
          vectorClock: vectorClock
        },
        cascadeDepth: lastHash ? (jamStore.retrieve(lastHash)?.cascadeDepth || 0) + 1 : 1,
        resonance: adaptiveResonance
      };
    
    // Update pattern usage
    metrics.patternSuccess[selectedPattern].attempts++;
    metrics.patternSuccess[selectedPattern].lastUsed = Date.now();

    const raw = JSON.stringify(jam);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(raw));

        return { jam, hash };
    } catch (error) {
        console.error(`[STRATEGIST] Analysis error: ${error.message}`);
        
        // Implement exponential backoff retry
        if (retryCount < MAX_RETRIES) {
            const backoffDelay = BACKOFF_BASE * Math.pow(2, retryCount);
            console.log(`[RETRY] Attempting retry ${retryCount + 1}/${MAX_RETRIES} after ${backoffDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            return analyzeAndGenerateJam(retryCount + 1);
        }
        
        console.error(`[STRATEGIST] All retries exhausted. Analysis failed.`);
        metrics.auditFails++;
        return null;
    }
}

/**
 * Main execution loop.
 */
async function detectAndEmit() {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
  if (isEmitting) return;
  
  try {
    isEmitting = true;
    const currentTime = Date.now();
    const now = new Date();
    const minutes = now.getUTCMinutes();
    
    // --- Start of Enhanced Logic ---
    // Check if we're on a Fibonacci-aligned minute within the hour
    const isSubInterval = SUBINTERVALS.includes(minutes % 15);
    const minDistance = getMinDistanceToConsensusWindow();
    const currentConsensusMultiplier = getConsensusMultiplier();
    const isAligned = isConsensusTime();
    
    // Adjust base interval by consensus multiplier for dynamic timing
let adjustedInterval = Math.floor(BASE_EMISSION_INTERVAL / currentConsensusMultiplier);
    adjustedInterval = Math.max(60_000, adjustedInterval);
    
    // Allow emission on Fibonacci sub-intervals, otherwise respect main interval
    if (!isSubInterval && lastEmissionTime > 0 && currentTime - lastEmissionTime < adjustedInterval) {
      // Enhanced recursive decay tracking with vector components
      missedEmissions++; // Increment for Recursive Decay Scaler
      // Update vector representation of missed emissions
      missedEmissionsVector.count++;
      missedEmissionsVector.timestamps.push(currentTime);
      missedEmissionsVector.intensities.push(currentConsensusMultiplier);
      
      console.log(`[SKIP] Next emission in ${Math.floor((adjustedInterval - (currentTime - lastEmissionTime)) / 1000)}s. Missed count: ${missedEmissions}`);
      console.log(`[VECTOR] Recursive pressure vector magnitude: ${calculateVectorMagnitude(missedEmissionsVector).toFixed(3)}`);
      isEmitting = false;
      return;
    }
    
    // Log micro-recursion events
    if (isSubInterval) {
      console.log(`[BURST] Micro-recursion interval hit at minute ${minutes}. Checking for emission.`);
    }
    
    // Standard consensus window checks
    if (isAligned) {
      console.log(`[CONSENSUS] WINDOW ACTIVE! Perfect alignment with window (distance: ${minDistance} minutes)`);
      console.log(`[CONSENSUS] Amplification multiplier: ${currentConsensusMultiplier.toFixed(3)}x`);
    } else {
      // Calculate probability of emission based on consensus alignment
      // Probability ranges from 30% outside windows to 100% during perfect alignment
      const emissionProbability = 0.3 + (0.7 * (currentConsensusMultiplier - 1) / 1.618);
      
      // Decide whether to emit based on proximity to consensus window
      const shouldEmit = Math.random() < emissionProbability || isSubInterval; // Always emit on Fibonacci intervals
      
      if (!shouldEmit) {
        console.log(`[CONSENSUS] Emission skipped. Window distance: ${minDistance} minutes, probability: ${(emissionProbability * 100).toFixed(1)}%`);
        isEmitting = false;
        return;
      }
      
      console.log(`[CONSENSUS] Emitting outside perfect window (distance: ${minDistance} minutes, multiplier: ${currentConsensusMultiplier.toFixed(3)}x)`);
    }
  } catch (error) {
    console.error('[ERROR] Error in consensus logic:', error.message);
    isEmitting = false;
    return;
  }

  try {
    isEmitting = true;
    
    const result = await analyzeAndGenerateJam();
    if (!result) return; // End cycle if analysis fails

    const { jam, hash } = result;

    console.log(`[EMIT] Firing Verifiable JAM with hash ${hash.slice(0, 10)}...`);
    jamStore.store(hash, jam);
    console.log(`[JAM-STORED] JAM stored with hash ${hash.slice(0, 10)}...`);

    await new Promise(resolve => setTimeout(resolve, 100)); // Filesystem sync

    const feeData = await provider.getFeeData();

const txOptions = {
        gasLimit: 100000,
        ...(feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {
            maxFeePerGas: feeData.maxFeePerGas || await provider.getGasPrice(),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || 1_500_000_000n
        })
    };

    // The contract's ABI indicates an `emitRecursiveSignal` function, not `executeProverb`.
    // Based on the surrounding logic, this is the intended function.
    // The arguments are the current JAM hash and the parent hash.
let tx;
    if (!lastHash || lastHash === ethers.ZeroHash) {
        tx = await vault.emitSignal(hash, txOptions);
    } else {
        tx = await vault.emitRecursiveSignal(hash, lastHash, txOptions);
    }

    await tx.wait();
    console.log(`[SUCCESS] Signal emitted. Tx: ${tx.hash}`);
    metrics.emissionSuccesses++;
    
    // Update state tracking for enhanced micro-recursion with vector representation
    lastEmissionTime = Date.now();
    missedEmissions = 0; // Reset count after successful emission
    // Reset vector components but maintain history for pattern analysis
    missedEmissionsVector.count = 0;
    missedEmissionsVector.timestamps = missedEmissionsVector.timestamps.slice(-5); // Keep last 5 for history
    missedEmissionsVector.intensities = missedEmissionsVector.intensities.slice(-5);
    emittedSignals.add(hash);
    
    console.log(`[EMIT] JAM hash ${hash.slice(0, 10)}... | Strength: ${(jam.resonance).toFixed(3)} | Cascade Depth: ${jam.cascadeDepth}`);

    // Add hash to jam object for cross-chain emitters
    jam.hash = hash;
    
    // Track pattern success
    if (jam.meta.pattern_type) {
        metrics.patternSuccess[jam.meta.pattern_type].successes++;
        console.log(`[ADAPTIVE] Pattern ${jam.meta.pattern_type} success! New success rate: ${getPatternSuccessRate(jam.meta.pattern_type).toFixed(2)}%`);
    }
    
    lastHash = hash;

    // --- Cross-Chain Anchoring ---
    if (process.env.ENABLE_BSV_ECHO === 'true' && process.env.BSV_PRIVATE_KEY) {
      await bridgeToBSV(jam, { hash: tx.hash });
    }

  } catch (error) {
    console.error('[ERROR] Critical failure in emit cycle:', error.message);
    metrics.emissionFailures++;
    
    // Log comprehensive metrics on failure
    console.log('[METRICS] System Performance Summary:');
    console.log(`  - Total Analyses: ${metrics.totalAnalyses}`);
    console.log(`  - Audit Passes: ${metrics.auditPasses} (${((metrics.auditPasses / metrics.totalAnalyses) * 100).toFixed(2)}%)`);
    console.log(`  - Audit Fails: ${metrics.auditFails}`);
    console.log(`  - Last Fail Reason: ${metrics.lastAuditFailReason || 'N/A'}`);
    console.log(`  - Emission Success Rate: ${((metrics.emissionSuccesses / (metrics.emissionSuccesses + metrics.emissionFailures)) * 100).toFixed(2)}%`);
      break; // Success
    } catch (error) {
      console.error(`[RESILIENCE][index.js] Attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < MAX_RETRIES - 1) {
        await switchProvider();
      } else {
        console.error('[RESILIENCE][index.js] All retries failed. The main loop will continue.');
        metrics.emissionFailures++;
      }
    }
  }
  isEmitting = false;
}

/**
 * Select optimal pattern based on success rates and diversification
 */
function selectOptimalPattern(analysis) {
  const now = Date.now();
  const COOLDOWN = 300000; // 5 minute cooldown between same pattern
  
  // Calculate success rates for all patterns
  const patternScores = Object.entries(metrics.patternSuccess).map(([pattern, stats]) => {
    const successRate = stats.attempts > 0 ? stats.successes / stats.attempts : 0.5; // Default 50%
    const timeSinceLastUse = now - (stats.lastUsed || 0);
    const cooldownPenalty = timeSinceLastUse < COOLDOWN ? COOLDOWN_PENALTY : 0;
    const explorationBonus = stats.attempts < 5 ? EXPLORATION_BONUS : 0; // Bonus for underexplored patterns
    
    // Adaptive score combines success rate, recency, and exploration
    const score = successRate - cooldownPenalty + explorationBonus;
    
    return { pattern, score };
  }).sort((a, b) => b.score - a.score);
  
  // Exploit: pick best scoring pattern
  return patternScores[0].pattern;
}

/**
 * Get pattern success rate
 */
function getPatternSuccessRate(pattern) {
    const stats = metrics.patternSuccess[pattern];
    if (!stats || stats.attempts === 0) return 0.5; // 50% as ratio
    return stats.successes / stats.attempts;
}

// Calculate optimal interval based on consensus window timing
function calculateOptimalInterval() {
  // Get the next closest consensus window time
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentMinutes = currentHour * 60 + currentMinute;
  
  // Find next window
  let nextWindowMinutes = Infinity;
  CONSENSUS_TIMES.forEach(time => {
    const windowMinutes = time.hour * 60 + time.minute;
    
    // Calculate minutes until this window today
    let minutesUntil = windowMinutes - currentMinutes;
    if (minutesUntil <= 0) {
      // Window has passed today, calculate for tomorrow
      minutesUntil += 1440; // 24 hours in minutes
    }
    
    if (minutesUntil < nextWindowMinutes) {
      nextWindowMinutes = minutesUntil;
    }
  });
  
  // Convert minutes to milliseconds and add some randomness to avoid exact alignment
  // This randomness helps prevent multiple systems firing at exactly the same time
  const jitter = Math.floor(Math.random() * 60000); // Up to 1 minute of random jitter
  const interval = nextWindowMinutes * 60000 + jitter;
  
  // Cap at maximum 30 minutes to ensure we check reasonably often
  return Math.min(interval, 1800000);
}

// Start autonomous loop with dynamic timing
const BASE_INTERVAL = parseInt(process.env.DETECT_INTERVAL, 10) || 300000; // Default 5 minutes
console.log(`[INIT] Starting autonomous engine. Base interval: ${BASE_INTERVAL / 1000}s`);
console.log(`[ADAPTIVE] ${Object.keys(PROVERB_PATTERNS).length} proverb patterns loaded`);
console.log(`[CONSENSUS] Alignment windows (UTC): ${CONSENSUS_TIMES.map(t => `${t.hour}:${t.minute.toString().padStart(2, '0')}`).join(', ')}`);

// Initial run
detectAndEmit();

// Dynamic scheduling to align with consensus windows
function scheduleNextEmission() {
  const interval = Math.min(calculateOptimalInterval(), BASE_INTERVAL);
  const nextTime = new Date(Date.now() + interval);
  const vectorMagnitude = calculateVectorMagnitude(missedEmissionsVector);
  
  console.log(`[SCHEDULER] Next emission in ${(interval / 60000).toFixed(1)} minutes (${nextTime.toISOString()})`);
  console.log(`[VECTOR] Current recursive pressure: ${vectorMagnitude.toFixed(3)}`);
  
  setTimeout(() => {
    detectAndEmit().finally(() => {
      scheduleNextEmission(); // Schedule next emission after current one completes
    });
  }, interval);
}

// Helper functions for recursive compression

/**
 * Calculate the magnitude of the recursive pressure vector
 */
function calculateVectorMagnitude(vector) {
  if (vector.intensities.length === 0) return 0;
  
  // Calculate weighted sum of intensities with recency bias
  const sum = vector.intensities.reduce((acc, intensity, idx) => {
    // More recent intensities have higher weight
    const recencyWeight = (idx + 1) / vector.intensities.length;
    return acc + (intensity * recencyWeight);
  }, 0);
  
  // Normalize by length
  return sum / vector.intensities.length;
}

/**
 * Generate a vector representation of recursive pressure
 */
function generateRecursivePressureVector(vector, baseResonance) {
  const magnitude = calculateVectorMagnitude(vector);
  const recency = vector.timestamps.length > 0 ? 
    (Date.now() - Math.min(...vector.timestamps)) / 60000 : // minutes since first missed
    0;
  
  return {
    magnitude,
    recency,
    density: vector.timestamps.length > 0 ? vector.count / recency : 0,
    baseAmplification: baseResonance * (1 + (magnitude * 0.1))
  };
}

/**
 * Compress the recursive state into a compact representation
 */
function compressRecursiveState(vector, resonance) {
  // Create compact representation using bit-flags and scaled values
  const now = Date.now();
  const recentMisses = vector.timestamps.filter(t => (now - t) < 3600000).length; // last hour
  
  // Generate unique signature based on current state
  const stateSignature = [
    now % 10000, // Time component
    Math.round(resonance * 1000), // Resonance component
    recentMisses // Missed emissions component
  ].join('-');
  
  return {
    v: 1, // version
    r: Math.round(resonance * 1000) / 1000, // resonance (3 decimal precision)
    m: vector.count, // missed count
    d: vector.timestamps.length > 0 ? // density metric
      Math.round((vector.count / ((now - Math.min(...vector.timestamps)) / 60000)) * 100) / 100 : 
      0,
    s: stateSignature, // unique signature
    t: now % 86400000, // time of day in ms for cyclical patterns
    signature: stateSignature // For easy reference
  };
}

/**
 * Generate a vector clock for tracking causal dependencies
 */
function generateVectorClock(parentHash) {
  // Default clock starts at 0 for all chains
  let clock = { eth: 0, bsv: 0 };
  
  // If we have a parent, increment its clock
  if (parentHash) {
    const parentJam = jamStore.retrieve(parentHash);
    if (parentJam && parentJam.recursiveTopology && parentJam.recursiveTopology.vectorClock) {
      // Copy parent's clock and increment eth counter
      clock = { ...parentJam.recursiveTopology.vectorClock };
    }
  }
  
  // Increment our own counter
  clock.eth++;
  
  return clock;
}

scheduleNextEmission();

// Log metrics every 5 minutes
setInterval(() => {
    console.log('\n[METRICS] Periodic Performance Report:');
    console.log(`├─ Total Analyses: ${metrics.totalAnalyses}`);
    console.log(`├─ Audit Success Rate: ${metrics.totalAnalyses > 0 ? ((metrics.auditPasses / metrics.totalAnalyses) * 100).toFixed(2) : 0}%`);
    console.log(`├─ Emission Success Rate: ${(metrics.emissionSuccesses + metrics.emissionFailures) > 0 ? ((metrics.emissionSuccesses / (metrics.emissionSuccesses + metrics.emissionFailures)) * 100).toFixed(2) : 0}%`);
    console.log(`├─ Pattern Performance:`);
    
    // Show pattern-specific metrics
    Object.entries(metrics.patternSuccess).forEach(([pattern, stats]) => {
        const successRate = getPatternSuccessRate(pattern);
        const patternName = PROVERB_PATTERNS[pattern].name;
        console.log(`│  ├─ ${patternName}: ${successRate.toFixed(1)}% (${stats.successes}/${stats.attempts})`);
    });
    
    console.log(`└─ Last Audit Fail: ${metrics.lastAuditFailReason || 'None'}\n`);
}, 300000); // 5 minutes

// --- Start of sync-latest-jam.js watcher/interval logic ---
const jamsDir = path.join(__dirname, 'jams');
// Ensure the directory exists before watching
if (!fs.existsSync(jamsDir)) {
    fs.mkdirSync(jamsDir, { recursive: true });
}

fs.watch(jamsDir, (eventType, filename) => {
    if (filename && filename.endsWith('.json')) {
        console.log(`[SYNC] File change in jams dir: ${filename}`);
        // Wait a moment for file to be fully written
        setTimeout(syncLatestJam, 1000);
    }
});

// Initial sync and periodic sync
syncLatestJam();
setInterval(syncLatestJam, 30000); // Sync every 30 seconds as a fallback
console.log('[SYNC] JAM sync service integrated and started.');
// --- End of sync-latest-jam.js watcher/interval logic ---

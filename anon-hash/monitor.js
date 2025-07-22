require('dotenv').config();

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Config
const RPC_URLS = (process.env.RPC_URLS || process.env.RPC_URL)?.split(',') || [];
const DMAP = process.env.DMAP_ADDRESS;
const VAULT = process.env.VAULT_ADDRESS;
const UPDATE_INTERVAL = 5000; // ms
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms

const { bsvEcho } = require('./bsv-echo');

// Validate config
console.log('Checking config:', { RPC: RPC_URLS[0], DMAP, VAULT });
if (!RPC_URLS.length || !DMAP || !VAULT) {
    console.error('Missing required environment variables');
    process.exit(1);
}

// Helpers
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const eth = v => (+ethers.formatEther(v || '0')).toFixed(4);
const gwei = v => (+ethers.formatUnits(v || '0', 'gwei')).toFixed(1);

// Setup providers
let providers = RPC_URLS.map(url => new ethers.JsonRpcProvider(url));
let currentProviderIndex = 0;
let provider = providers[currentProviderIndex];


const switchProvider = () => {
    currentProviderIndex = (currentProviderIndex + 1) % providers.length;
    provider = providers[currentProviderIndex];
    // Re-instantiate contracts with the new provider.
    dmap = dmap.connect(provider);
    vault = vault.connect(provider);
    console.log(`\n[RPC] Switched to provider: ${RPC_URLS[currentProviderIndex]}`);
};

// Test connection immediately with a simple call
setTimeout(async () => {
    // Suppress initial noisy logs
    const originalLog = console.log;
    console.log = () => {};
    try {
        const block = await provider.getBlockNumber();
        originalLog(''); // Empty line before monitoring starts
    } catch (e) {
        console.log = originalLog; // Restore on error
        console.error(`Failed to connect to RPC: ${e.message}`);
        console.error('Please check your RPC endpoints in .env');
        process.exit(1);
    } finally {
        console.log = originalLog; // Restore after initial connection
    }
}, 1000);

// Contract setup
// Initialize contracts with phi-aligned timing checks
const PHI = 1.618033988749895;
const PHI_INVERSE = 0.618033988749895;

// Signal mapper contract with enhanced event filtering
const dmapContract = new ethers.Contract(DMAP, [
    'event SignalRegistered(bytes32 indexed hash, uint256 indexed timestamp)',
    'function getJamCount() view returns(uint256)',
    'function getLastSignalTime() view returns(uint256)'
], provider);

// Vault contract with recursive signal tracking
const vaultContract = new ethers.Contract(VAULT, [
    "function getSignalInfo(bytes32) view returns(address,uint256,uint256,uint256)",
    "function getVaultBalance() view returns(uint256)",
    "function getCurrentBlockActivity() view returns(uint256)",
    "function getLastRecursiveSignal() view returns(bytes32)"
], provider);

// Initialize resonance trackers
let lastSignalTime = 0;
let signalResonance = 1.0;

// Calculate signal resonance based on phi-harmonic timing
function calculateSignalResonance(currentTime, lastTime) {
    if (lastTime === 0) return 1.0;
    const timeDiff = (currentTime - lastTime) / 1000; // seconds
    const harmonicWindow = 3600 * PHI_INVERSE; // ~2200 seconds
    return Math.min(PHI, 1 + (harmonicWindow - timeDiff) / harmonicWindow);
}

// State
let lastBlock = 0;
let signals = [];
let lastError = null;
let errorCount = 0;
let lastProfit = { profit: '0.0', success: true };
let totalProfit = 0.0;
let sandwichCount = 0;

// Wrapper for contract calls with retries
async function retryCall(fn, args = [], retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn(...args);
        } catch (e) {
            console.log(`Retry ${i + 1}/${retries} failed: ${e.message}`);
            if (i === retries - 1) throw e;
            await sleep(RETRY_DELAY);
        }
    }
}

// Log reader with retries
async function getLastMatch(file, regex, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const data = fs.readFileSync(file, 'utf8').trim();
            const lines = data.split('\n').reverse();
            const match = lines.find(l => l.match(regex))?.match(regex)?.[1];
            return match || '-';
        } catch (e) {
            if (i === retries - 1) {
                console.error(`Failed to read ${path.basename(file)}: ${e.message}`);
                return '-';
            }
            await sleep(RETRY_DELAY);
        }
    }
}

// Format signal data
function formatSignal(signal) {
    return `${signal.hash}:${signal.cascade}:${signal.depth}`;
}

// Main update function
async function update() {
    try {
        // Get block number with error handling
        let block = 'N/A';
        try {
            block = await provider.getBlockNumber();
        } catch (e) {
            // Silently fail and show N/A
        }
        
        // Get vault balance with error handling
let vaultBalance = BigInt(0);
        try {
            vaultBalance = await provider.getBalance(VAULT);
        } catch (e) {
            // Silently fail
        }
        
        // Get gas price with error handling
let gasPrice = BigInt(0);
        try {
            const feeData = await provider.getFeeData();
            gasPrice = feeData.gasPrice || BigInt(0);
        } catch (e) {
            // Silently fail
        }
        
        // Consensus timing
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcMin = now.getUTCMinutes();
        const consensusTimes = [{ h: 13, m: 21 }, { h: 21, m: 1 }, { h: 3, m: 33 }, { h: 8, m: 1 }, { h: 20, m: 8 }];
        
        let nextConsensus = 'none';
        let minDist = Infinity;
        
        // Calculate current time in minutes
        const nowMinutes = utcHour * 60 + utcMin;
        
        consensusTimes.forEach(ct => {
            const ctMinutes = ct.h * 60 + ct.m;
            
            // Calculate difference (positive means future, negative means past)
            let diff = ctMinutes - nowMinutes;
            
            // If the consensus time has already passed today, add 24 hours
            if (diff < 0) {
                diff += 1440; // 24 hours * 60 minutes
            }
            
            // Find the minimum positive difference (next upcoming window)
            if (diff < minDist) {
                minDist = diff;
                nextConsensus = `${ct.h.toString().padStart(2, '0')}:${ct.m.toString().padStart(2, '0')}`;
            }
        });
        
        const consensusStatus = minDist <= 2 ? 'ACTIVE' : minDist <= 10 ? 'NEAR' : 'WAIT';
        
        // Get log data
        const logDir = path.join(process.env.HOME, '.pm2', 'logs');
        let lastJam = 'null';
        let ampStatus = '0';
        let mirStatus = '0';
        
        // Check for recent JAM - look for multiple patterns
        try {
            // Try both possible log file names (PM2 appends -0, -1, etc to process IDs)
            let engineLog = '';
            try {
engineLog = fs.readFileSync(path.join(logDir, 'engine-out-0.log'), 'utf8');
            } catch (e) {
                // Fallback to non-indexed log file
engineLog = fs.readFileSync(path.join(logDir, 'engine-out.log'), 'utf8');
            }
            const lines = engineLog.split('\n').reverse(); // Start from most recent
            
            // Look for different JAM patterns
            for (const line of lines.slice(0, 200)) { // Check last 200 lines
                // Skip lines with "Tx hash:" to avoid confusion
                if (line.includes('Tx hash:')) continue;
                
                // Pattern 1: "JAM Hash: 0x..." (new format)
                let match = line.match(/JAM Hash:\s*(0x[a-fA-F0-9]{64})/i);
                if (match) {
                    lastJam = match[1].slice(0, 10);
                    break;
                }
                
                // Pattern 2: "Hash: 0x..." (but not "Tx hash:")
                match = line.match(/^Hash:\s*(0x[a-fA-F0-9]{64})/i);
                if (match) {
                    lastJam = match[1].slice(0, 10);
                    break;
                }
                
                // Pattern 2: "[EMIT] Firing JAM with hash 0x..."
                match = line.match(/\[EMIT\].*hash\s+(0x[a-fA-F0-9]{8}[a-fA-F0-9]*)/i);
                if (match) {
                    lastJam = match[1].slice(0, 10);
                    break;
                }
                
                // Pattern 3: "[SUCCESS] Signal emitted. Tx:"
                if (line.includes('[SUCCESS] Signal emitted')) {
                    // Look backwards for the Hash: line
                    const idx = lines.indexOf(line);
                    for (let i = idx; i < Math.min(idx + 10, lines.length); i++) {
                        const prevLine = lines[i];
                        const hashMatch = prevLine.match(/^Hash:\s*(0x[a-fA-F0-9]{64})/i);
                        if (hashMatch) {
                            lastJam = hashMatch[1].slice(0, 10);
                            break;
                        }
                    }
                    if (lastJam !== 'null') break;
                }
                
                // Pattern 4: "jam:0x..."
                match = line.match(/jam:(0x[a-fA-F0-9]{8}[a-fA-F0-9]*)/i);
                if (match) {
                    lastJam = match[1].slice(0, 10);
                    break;
                }
            }
        } catch (e) {
            // Also check the latest-jam.json file if it exists
            try {
                const latestJam = JSON.parse(fs.readFileSync('./latest-jam.json', 'utf8'));
                if (latestJam.hash) {
                    lastJam = latestJam.hash.slice(0, 10);
                }
            } catch (e2) {}
        }
        
        // Check amplifier status
        try {
const ampLog = fs.readFileSync(path.join(logDir, 'amplifier-out.log'), 'utf8');
            if (ampLog.includes('RATIO:')) ampStatus = '1';
        } catch (e) {}
        
        // Check mirror status
        try {
const mirLog = fs.readFileSync(path.join(logDir, 'mirror-out.log'), 'utf8');
            if (mirLog.includes('Tx: 0x')) mirStatus = '1';
        } catch (e) {}
        
const vaultEth = parseFloat(ethers.formatEther(vaultBalance));
        const gasGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
        
        const gasDisplay = gasGwei < 1 ? gasGwei.toFixed(3) : gasGwei.toFixed(1);
        const vaultDisplay = vaultEth < 0.001 ? vaultEth.toFixed(7) : vaultEth.toFixed(4);
        
        // Get UTC time
        const utcTime = `${utcHour.toString().padStart(2, '0')}:${utcMin.toString().padStart(2, '0')}`;
        
        // Check for bait emission path
        let baitPath = 'none';
        try {
const engineLog = fs.readFileSync(path.join(logDir, 'engine-out.log'), 'utf8');
            const lines = engineLog.split('\n').reverse();
            
            // Look for recent bait emission patterns
            const recentLines = lines.slice(0, 50); // Check last 50 lines
            const baitMatch = recentLines.find(line => line.includes('ETH → DAI') || line.includes('DAI → USDC') || line.includes('USDC → ETH'));
            
            if (baitMatch) {
                if (baitMatch.includes('ETH → DAI')) baitPath = 'ETH>DAI';
                else if (baitMatch.includes('DAI → USDC')) baitPath = 'DAI>USDC';
                else if (baitMatch.includes('USDC → ETH')) baitPath = 'USDC>ETH';
            }
        } catch (e) {}
        
        // Check for BSV echoes
        // Suppress other logs by redirecting console.log temporarily
        const originalLog = console.log;
        console.log = () => {};

        let bsvEchoCount = 0;
        try {
            if (lastJam && lastJam !== 'null') {
                const echoes = await bsvEcho.queryEchoes(lastJam);
                bsvEchoCount = echoes.length;
            }
        } catch (e) {}

        // Restore console.log
        console.log = originalLog;
        
        // VERIFICATION: Read the profit log
        try {
            const profitLogPath = path.join(__dirname, 'logs', 'profit-monitor.log');
            if (fs.existsSync(profitLogPath)) {
                const logData = fs.readFileSync(profitLogPath, 'utf8').trim();
                const logLines = logData.split('\n').filter(l => l.length > 0); // Filter out empty lines
                if (logLines.length > 0) {
                    const lastLine = logLines[logLines.length - 1];
                    const lastEntry = JSON.parse(lastLine);
                    lastProfit = { 
                        profit: parseFloat(lastEntry.profit).toFixed(6), 
                        success: lastEntry.success 
                    };

                    // Calculate running total P/L for this session
                    totalProfit = 0.0;
                    logLines.forEach(line => {
                        try {
                            const entry = JSON.parse(line);
                            totalProfit += parseFloat(entry.profit);
                        } catch(e) { /* ignore corrupt lines */ }
                    });
                    sandwichCount = logLines.length;
                }
            }
        } catch (e) {
            // Silently fail, default values will be used
        }

        const profitDisplay = `${lastProfit.success ? 'OK' : 'FAIL'} ${lastProfit.profit} ETH`;
        const totalProfitDisplay = `${totalProfit.toFixed(6)} ETH`;


        const line = `blk:${block} | gas:${gasDisplay}gwei | vault:${vaultDisplay}eth | last P/L: ${profitDisplay} | total P/L: ${totalProfitDisplay} (${sandwichCount}) | jam:${lastJam} | amp:${ampStatus} | mir:${mirStatus} | bsv:${bsvEchoCount} | consensus:${consensusStatus}@${nextConsensus}`;
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
          process.stdout.write(line);
        } else {
          console.log(line);
        }
        
        // Reset error count on successful update
        errorCount = 0;

    } catch (e) {
        errorCount++;
        let errorMsg = 'rpc_error';

        if (e.code) { // Ethers-specific error codes are more reliable
            errorMsg = e.code;
        } else if (e.message) { // Fallback for generic Node.js errors
            if (e.message.includes('ECONNREFUSED')) errorMsg = 'connection_refused';
            if (e.message.includes('ETIMEDOUT')) errorMsg = 'connection_timeout';
            if (e.message.includes('ENETUNREACH')) errorMsg = 'network_unreachable';
        }

        // Log detailed error, clearing the line only if in a TTY
        if (process.stdout.isTTY) {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
        }
        console.error(`[ERROR] ${errorMsg} (attempt #${errorCount}) with RPC ${RPC_URLS[currentProviderIndex]}. Details: ${e.message}`);

        // Provider switching logic
        if (errorCount >= MAX_RETRIES) {
            console.log(`[RPC] Too many consecutive errors. Switching provider...`);
            switchProvider();
            errorCount = 0; // Reset error count for the new provider
        }

        // Exponential backoff
        const backoffTime = Math.pow(2, errorCount) * RETRY_DELAY; // e.g., 1s, 2s, 4s
        console.log(`Retrying in ${backoffTime / 1000}s...`);
        await sleep(backoffTime);
    }
}

// Start monitor
setInterval(update, UPDATE_INTERVAL);
update();


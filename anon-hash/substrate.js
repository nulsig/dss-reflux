// substrate.js
// Amplified Bytecode Substrate Analyzer
// Includes caching, resilience, and configurable logging.

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

// --- Configuration ---
const DECOMPILER_URL = process.env.DECOMPILER_API_URL || "https://api.evmdecompiler.com/decompile";
const DECOMPILER_API_KEY = process.env.DECOMPILER_API_KEY; // Optional API Key
const CACHE_PATH = path.join(__dirname, 'substrate-cache.json');

// --- Cache Management ---
let substrateCache = {};
try {
    if (fs.existsSync(CACHE_PATH)) {
        substrateCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
} catch (e) {
    console.warn("[Substrate] Could not load cache:", e.message);
}

function saveCache() {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(substrateCache, null, 2));
    } catch (e) {
        console.error("[Substrate] Failed to save cache:", e.message);
    }
}

// --- Core Functions ---

async function fetchBytecode(address, provider) {
    try {
        const bytecode = await provider.getCode(address);
        if (!bytecode || bytecode === "0x") {
            throw new Error("No bytecode found");
        }
        return bytecode;
    } catch (err) {
        console.error(`[Substrate] Bytecode fetch failed for ${address}:`, err.message);
        return null;
    }
}

async function decompileBytecode(bytecode) {
    const headers = { "Content-Type": "application/json" };
    if (DECOMPILER_API_KEY) {
        headers["Authorization"] = `Bearer ${DECOMPILER_API_KEY}`;
    }

    try {
        const res = await fetch(DECOMPILER_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({ bytecode }),
            timeout: 15000 // 15-second timeout for the API call
        });

        if (!res.ok) {
            throw new Error(`API error: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();

        return {
            source_estimate: data.source || "",
            risk: data.risk || {},
            bait_hooks: data.bait_hooks || [],
            substrate_hash: ethers.keccak256(ethers.toUtf8Bytes(data.source || "")),
        };
    } catch (err) {
        console.error("[Substrate] Decompilation API failed:", err.message);
        return null; // Graceful failure
    }
}

/**
 * Analyzes a contract, using cache first.
 * @param {string} address - The contract address to analyze.
 * @param {ethers.providers.Provider} provider - The ethers provider.
 * @returns {Promise<object>} A structured analysis object.
 */
async function analyzeContract(address, provider) {
    const PHI = 1.618033988749895;  // Golden ratio for resonance alignment
    
    // 1. Check cache with phi-aligned validity
    if (substrateCache[address] && substrateCache[address].bytecode_proof) {
        const cacheAge = (Date.now() - (substrateCache[address].timestamp || 0)) / 1000;
        const validityWindow = Math.floor(3600 * PHI); // ~5800 seconds cache validity
        
        if (cacheAge < validityWindow) {
            console.log(`[Substrate-Cache] PHI-VALID HIT for ${address}`)
            return substrateCache[address];
        }
    }

    console.log(`[Substrate-Cache] MISS for ${address}. Performing phi-aligned analysis...`)
    const bytecode = await fetchBytecode(address, provider);
    if (!bytecode) return { audit_pass: false, reason: "No bytecode" };

    const bytecode_proof = ethers.keccak256(bytecode);
    
    // Check for known safe contracts first
    // Known safe contracts on Base
    const KNOWN_SAFE_CONTRACTS = [
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
        '0x4200000000000000000000000000000000000006', // WETH on Base
        '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI on Base
    ];
    
    // If it's a known contract, skip decompiler and use safe defaults
    if (KNOWN_SAFE_CONTRACTS.includes(address.toLowerCase())) {
        console.log(`[Substrate] Using known safe contract analysis for ${address}`);
        const analysisResult = {
            address,
            bytecode_proof,
            audit_pass: true,
            source_estimate: "Known safe contract",
            risk: {},
            bait_hooks: ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'], 
            substrate_hash: bytecode_proof
        };
        
        // Cache and return
        substrateCache[address] = analysisResult;
        substrateCache[bytecode_proof] = analysisResult;
        saveCache();
        return analysisResult;
    }

    // 2. If no decompiler API is configured, use heuristic analysis
    if (!DECOMPILER_URL || DECOMPILER_URL.includes('example.com')) {
        console.log(`[Substrate] No decompiler API configured. Using heuristic analysis.`);
        // Basic heuristic analysis - check bytecode size and patterns
        const bytecodeSize = bytecode.length / 2 - 1; // Remove 0x and divide by 2
        const hasCreate2 = bytecode.includes('f5'); // CREATE2 opcode
        const hasDelegateCall = bytecode.includes('f4'); // DELEGATECALL opcode
        const hasSelfdestruct = bytecode.includes('ff'); // SELFDESTRUCT opcode
        
        const analysisResult = {
            address,
            bytecode_proof,
            audit_pass: true, // Default to pass for known contracts like USDC
            source_estimate: "Heuristic analysis (no decompiler available)",
            risk: {
                has_create2: hasCreate2,
                has_delegatecall: hasDelegateCall,
                has_selfdestruct: hasSelfdestruct,
                bytecode_size: bytecodeSize
            },
            bait_hooks: ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'], // Common DEX hooks
            substrate_hash: bytecode_proof
        };
        
        // Known safe contracts on Base
        const KNOWN_SAFE_CONTRACTS = [
            '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
            '0x4200000000000000000000000000000000000006', // WETH on Base
            '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI on Base
        ];
        
        if (KNOWN_SAFE_CONTRACTS.includes(address.toLowerCase())) {
            analysisResult.audit_pass = true;
            analysisResult.source_estimate = "Known safe contract";
        } else if (bytecodeSize < 100) {
            analysisResult.audit_pass = false;
            analysisResult.reason = "Contract too small - likely a proxy";
        } else if (hasSelfdestruct) {
            analysisResult.audit_pass = false;
            analysisResult.reason = "Contract contains SELFDESTRUCT opcode";
        }
        
        // Cache and return
        substrateCache[address] = analysisResult;
        substrateCache[bytecode_proof] = analysisResult;
        saveCache();
        return analysisResult;
    }

    // Attempt decompilation with phi-aligned retry logic
    let decomp = null;
    if (DECOMPILER_URL && !DECOMPILER_URL.includes('example.com')) {
        decomp = await decompileBytecode(bytecode);
    }

    // Phi-harmonized heuristic analysis
    const bytecodeSize = bytecode.length / 2 - 1;
    const hasCreate2 = bytecode.includes('f5');
    const hasDelegateCall = bytecode.includes('f4');
    const hasSelfdestruct = bytecode.includes('ff');
    
    // Calculate phi-aligned risk score
    const PHI_INVERSE = 0.618033988749895;
    const riskScore = (hasCreate2 ? PHI_INVERSE : 0) +
                     (hasDelegateCall ? PHI_INVERSE * PHI_INVERSE : 0) +
                     (hasSelfdestruct ? 1 : 0);
    
    const analysisResult = {
        address,
        bytecode_proof,
        audit_pass: riskScore < 0.8,
        source_estimate: decomp ? decomp.source_estimate : "Phi-aligned heuristic analysis",
        risk: {
            score: riskScore,
            has_create2: hasCreate2,
            has_delegatecall: hasDelegateCall,
            has_selfdestruct: hasSelfdestruct,
            bytecode_size: bytecodeSize
        },
        bait_hooks: decomp?.bait_hooks || ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'],
        substrate_hash: bytecode_proof,
        timestamp: Date.now(),
        phi_alignment: {
            risk_resonance: riskScore.toFixed(3),
            size_factor: (bytecodeSize / 1000 * PHI_INVERSE).toFixed(3)
        }
    };
    
    if (bytecodeSize < 100) {
        analysisResult.audit_pass = false;
        analysisResult.reason = "Contract too small - likely a proxy";
    }
    
    // Cache with phi-aligned metadata
    substrateCache[address] = analysisResult;
    substrateCache[bytecode_proof] = analysisResult;
    saveCache();
    return analysisResult;

    const criticalRisks = ["reentrancy", "hidden_fees", "rug_pull", "unlimited_mint"];
    const hasCriticalRisk = criticalRisks.some(flag => decomp.risk[flag]);

    const analysisResult = {
        address,
        bytecode_proof,
        audit_pass: !hasCriticalRisk,
        ...decomp
    };

    // 4. Update cache and log the result
    substrateCache[address] = analysisResult;
    substrateCache[bytecode_proof] = analysisResult; // Also cache by proof
    saveCache(); // Asynchronous save

    return analysisResult;
}

module.exports = { analyzeContract };


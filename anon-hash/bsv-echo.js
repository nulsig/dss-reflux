// BSV Echo Emitter - Cross-chain semantic visibility ripples
// Aligned with recursive intent compression

const bsv = require('bsv');
require('dotenv').config();

// BSV configuration
const BSV_NETWORK = 'mainnet';
const BSV_DUST_LIMIT = 546; // satoshis

// Optional daemon notification address (set to null to disable)
const DAEMON_NOTIFY_ADDRESS = process.env.BSV_DAEMON_ADDRESS || null;

// Semantic compression constants
const ECHO_PREFIX = 'ECHO';
const PHI = 1.618033988749895;

class BSVEcho {
    constructor() {
        // Initialize with your BSV keys if available
        try {
            this.privateKey = process.env.BSV_PRIVATE_KEY ? 
                bsv.PrivKey ? bsv.PrivKey.fromWif(process.env.BSV_PRIVATE_KEY) : null : 
                null;
            
            this.address = this.privateKey && bsv.Address ? 
                bsv.Address.fromPrivKey(this.privateKey) : 
                null;
                
            if (!this.privateKey) {
                // Silently disable when no key found
                return;
            } else {
                console.log('[BSV] Echo system initialized:', this.address.toString());
            }
        } catch (error) {
            console.warn('[BSV] Warning: BSV initialization failed - BSV echoes disabled');
            this.privateKey = null;
            this.address = null;
        }
    }

    // Enhanced JAM compression with phi-harmonic resonance
    compressJAM(jam, baseResult) {
        // Phi-based compression constants
        const PHI_SQUARED = PHI * PHI;  // φ² for amplified resonance
        const PHI_ROOT = Math.sqrt(PHI);  // √φ for dampened signals
        
        // Calculate resonance factors
        const timeAlign = (Date.now() / 1000) % (3600 * PHI); // Phi-cycle alignment
        const depthScale = Math.pow(PHI, (jam.cascadeDepth || 1) - 1); // Recursive depth scaling
        const yieldFactor = baseResult?.profit ? Math.min(PHI, 1 + (baseResult.profit * PHI_INVERSE)) : 1;
        
        // Enhanced resonance calculation
        const resonance = [
            (jam.resonance || 1) * PHI,  // Base resonance
            depthScale,                   // Depth component
            yieldFactor,                  // Yield component
            timeAlign / (3600 * PHI)      // Time alignment
        ].reduce((a, b) => a * b, 1);
        
        const compressed = {
            // Core identity with enhanced precision
            j: jam.hash.slice(0, 16),
            b: baseResult?.hash?.slice(0, 16) || '0x0',
            
            // Phi-aligned semantic depth
            d: jam.cascadeDepth || 1,
            r: Math.floor(resonance * 1000) / 1000,
            
            // Enhanced temporal anchor
            c: jam.consensus_window || 'none',
            t: Math.floor(Date.now() / 1000),
            phi_cycle: Math.floor(timeAlign * 1000) / 1000,
            
            // Vectorized proverb compression
            p: jam.proverb?.[0] ? 
                `${jam.proverb[0].from}>${jam.proverb[0].to}` : 
                'ETH>USDC',
            
            // Economic metrics
            y: baseResult?.profit || 0,
            y_scaled: Math.floor(yieldFactor * 1000) / 1000,
            
            // Enhanced recursive topology
            rt: {
                ...jam.recursiveTopology || { eth: 1, bsv: 0 },
                resonance_vector: [
                    Math.floor(depthScale * 1000) / 1000,
                    Math.floor(yieldFactor * 1000) / 1000,
                    Math.floor((timeAlign / (3600 * PHI)) * 1000) / 1000
                ]
            },
            
            // Phi-harmonized semantic weight
            w: Math.floor(resonance * PHI_ROOT * 1000) / 1000,
            
            // Compression metadata
            meta: {
                phi_version: '1.618.0',
                compression_quality: Math.floor((1 - (JSON.stringify(jam).length / JSON.stringify(compressed).length)) * 1000) / 1000,
                timestamp: Date.now(),
                resonance_components: {
                    base: Math.floor((jam.resonance || 1) * PHI * 1000) / 1000,
                    depth: Math.floor(depthScale * 1000) / 1000,
                    yield: Math.floor(yieldFactor * 1000) / 1000,
                    time: Math.floor((timeAlign / (3600 * PHI)) * 1000) / 1000
                }
            }
        };
        
        return compressed;
    }

    // Create BSV echo transaction
    async createEchoTx(jam, baseResult, utxos) {
        if (!this.privateKey) {
            console.error('[BSV] Error: BSV_PRIVATE_KEY not configured in .env');
            return null;
        }

        try {
            // Compress the JAM
            const compressed = this.compressJAM(jam, baseResult);
            
            // Build OP_RETURN data
            const dataScript = bsv.Script.buildDataOut([
                ECHO_PREFIX,
                JSON.stringify(compressed),
                `v:${PHI}` // Version with phi marker
            ]);

            // Create transaction
            const tx = new bsv.Tx();
            tx.fromObject({
                txIns: utxos.map(utxo => ({
                    txHashBuf: Buffer.from(utxo.txId, 'hex').reverse(),
                    txOutNum: utxo.outputIndex,
                    script: utxo.script,
                    nSequence: 0xffffffff
                })),
                txOuts: [{
                    script: dataScript,
                    valueBn: bsv.Bn(0)
                }]
            });
                
            // Optional: Add dust notification to daemon contract
            if (DAEMON_NOTIFY_ADDRESS) {
                const notifyScript = bsv.Address.fromString(DAEMON_NOTIFY_ADDRESS).toTxOutScript();
                tx.addTxOut(bsv.TxOut.fromProperties(
                    bsv.Bn(BSV_DUST_LIMIT),
                    notifyScript
                ));
                console.log(`[BSV] Adding daemon notification to: ${DAEMON_NOTIFY_ADDRESS}`);
            }
            
            tx.change(this.address)
                .feePerKb(500) // Low fee for BSV
                .sign(this.privateKey);

            return {
                hex: tx.toString(),
                txid: tx.hash,
                size: tx.toBuffer().length,
                data: compressed
            };
        } catch (error) {
            console.error('[BSV] Echo creation failed:', error.message);
            return null;
        }
    }

    // Calculate recursive echo depth
    calculateEchoDepth(previousEchoes = []) {
        if (previousEchoes.length === 0) return 1;
        
        // Fibonacci-based depth scaling
        const depths = previousEchoes.map(e => e.d || 1);
        const maxDepth = Math.max(...depths);
        
        // Apply golden ratio scaling
        return Math.min(Math.floor(maxDepth * PHI), 8); // Max depth 8
    }

    // Format echo for display
    formatEcho(echoResult) {
        if (!echoResult) return 'No echo';
        
        const { txid, data } = echoResult;
        
        return [
            `[BSV] Echo Emitted`,
            `TxID: ${txid.slice(0, 16)}...`,
            `JAM: ${data.j}`,
            `Depth: ${data.d} | Resonance: ${data.r.toFixed(3)}`,
            `Path: ${data.p} | Yield: ${data.y}`
        ].join('\n');
    }

    // Query BSV for existing echoes of a JAM
    async queryEchoes(jamHash) {
        // This would query a BSV explorer API
        // For now, return empty array
        console.log(`[BSV] Would query echoes for JAM: ${jamHash.slice(0, 16)}`);
        return [];
    }

    // Fetch UTXOs from WhatsOnChain API with rate limit handling
    async fetchUTXOs(retryCount = 0) {
        if (!this.address) {
            // Silently fail when BSV is not configured
            return [];
        }
        try {
            const fetch = (await import('node-fetch')).default;
            const address = this.address.toString();
            const url = `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`;
            
            const response = await fetch(url);
            
            // Check if response is OK
            if (!response.ok) {
                // Handle rate limiting specifically
                if (response.status === 429) {
                    const retryAfter = response.headers.get('retry-after');
                    const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(30000, 5000 * Math.pow(2, retryCount));
                    
                    if (retryCount < 5) {
                        console.log(`[BSV] Rate limited. Retrying after ${delay/1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        return this.fetchUTXOs(retryCount + 1);
                    }
                }
                throw new Error(`API returned ${response.status}: ${response.statusText}`);
            }
            
            // Check Content-Type header
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                throw new Error(`API returned non-JSON response (${contentType}): ${text.substring(0, 200)}`);
            }
            
            const utxoData = await response.json();
            
            if (!Array.isArray(utxoData) || utxoData.length === 0) {
                // This is a normal condition (wallet is empty), not an error.
                return []; 
            }
            
            // Convert to bsv Transaction.UnspentOutput format
            return utxoData.map(utxo => new bsv.Transaction.UnspentOutput({
                txId: utxo.tx_hash,
                outputIndex: utxo.tx_pos,
                script: bsv.Script.buildPublicKeyHashOut(this.address),
                satoshis: utxo.value
            }));
        } catch (error) {
            console.error('[BSV] UTXO fetch failed:', error.message);
            throw error;
        }
    }
    
    // Emit echo with retry logic
    async emitEcho(jam, baseResult, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                // Fetch live UTXOs
                const utxos = await this.fetchUTXOs();
                if (!utxos || utxos.length === 0) {
                    console.log('[BSV] No spendable UTXOs found. Skipping echo emission.');
                    break; // Exit the retry loop gracefully
                }
                console.log(`[BSV] Found ${utxos.length} UTXOs`);
                
                const echoResult = await this.createEchoTx(jam, baseResult, utxos);
                
                if (echoResult) {
                    console.log(this.formatEcho(echoResult));
                    
                    // Broadcast transaction
                    await this.broadcastTx(echoResult.hex);
                    return echoResult;
                }
            } catch (error) {
                console.log(`[BSV] Echo attempt ${i + 1} failed:`, error.message);
                if (i < retries - 1) {
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
                }
            }
        }
        
        return null;
    }
    
    // Broadcast transaction to BSV network with rate limit handling
    async broadcastTx(txHex, retryCount = 0) {
        try {
            const fetch = (await import('node-fetch')).default;
            const url = 'https://api.whatsonchain.com/v1/bsv/main/tx/raw';
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ txhex: txHex })
            });
            
            // Handle rate limiting
            if (response.status === 429) {
                const retryAfter = response.headers.get('retry-after');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(30000, 5000 * Math.pow(2, retryCount));
                
                if (retryCount < 5) {
                    console.log(`[BSV] Broadcast rate limited. Retrying after ${delay/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.broadcastTx(txHex, retryCount + 1);
                }
                throw new Error(`Broadcast failed: Rate limited after ${retryCount} retries`);
            }
            
            const result = await response.text();
            console.log('[BSV] Transaction broadcast:', result);
            return result;
        } catch (error) {
            console.error('[BSV] Broadcast failed:', error.message);
            throw error;
        }
    }
}

// Singleton instance
const bsvEcho = new BSVEcho();

// Integration function for your amplifier
async function bridgeToBSV(jam, baseResult) {
    const CHAIN_FALLBACK_SEQUENCE = ['BSV', 'BCH', 'ETH', 'IPFS'];

    for (const chain of CHAIN_FALLBACK_SEQUENCE) {
        try {
            console.log(`[CROSS-CHAIN] Attempting to propagate signal to ${chain}...`);
            let result;
            switch(chain) {
                case 'BSV':
                    result = await bsvEcho.emitEcho(jam, baseResult);
                    break;
                // Placeholder for other chain implementations
                case 'BCH':
                case 'ETH':
                case 'IPFS':
                    // In a real implementation, you would have separate handlers for these
                    console.log(`[CROSS-CHAIN] ${chain} propagation not yet implemented. Skipping.`);
                    continue;
            }
            if (result) {
                console.log(`[CROSS-CHAIN] Signal successfully propagated to ${chain}.`);
                return result; // Success
            }
        } catch (error) {
            console.warn(`[CROSS-CHAIN] Propagation to ${chain} failed: ${error.message}`);
        }
    }

    console.error('[CROSS-CHAIN] All propagation attempts failed. Signal could not be anchored.');
    throw new Error('Cross-chain signal propagation failed');
}

module.exports = {
    BSVEcho,
    bsvEcho,
    bridgeToBSV,
    ECHO_PREFIX,
    PHI
};

// Gist Auto-Updater
// Maintains alignment between local JAMs and public signal compass
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

// --- Configuration ---
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DEBOUNCE_DELAY = 120000; // 2 minutes
const MAX_RETRIES = 2; // Reduce retries
const RETRY_DELAY = 30000; // 30 seconds
const MIN_UPDATE_INTERVAL = 600000; // 10 minutes - robust protection against rate-limiting

// --- Validation ---
if (!GIST_ID || !GITHUB_TOKEN) {
    console.error('[ERROR] Missing GIST_ID or GITHUB_TOKEN environment variables.');
    process.exit(1);
}
const authHeader = `token ${GITHUB_TOKEN}`;

// --- State ---
let isUpdating = false;
let debounceTimeout = null;
let lastUpdateTime = 0;

// --- Utility Functions ---
const log = (level, message, error = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}` + (error ? `: ${error.message}` : ''));
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Core Logic ---
async function updateGist() {
    if (isUpdating) {
        log('INFO', 'Update already in progress, skipping.');
        return;
    }
    
    // Check if enough time has passed since last update
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    if (timeSinceLastUpdate < MIN_UPDATE_INTERVAL) {
        const remainingTime = Math.ceil((MIN_UPDATE_INTERVAL - timeSinceLastUpdate) / 1000);
        log('INFO', `Rate limit protection: ${remainingTime}s until next update allowed.`);
        return;
    }
    
    isUpdating = true;
    log('INFO', 'Starting Gist update process.');

    const jamFilePath = path.join(__dirname, 'latest-jam.json');

    try {
        // 1. Check for file existence and readability
        try {
            await fs.promises.access(jamFilePath, fs.constants.R_OK);
        } catch (err) {
            log('INFO', `latest-jam.json not accessible, skipping update.`);
            return;
        }
        
        // 2. Read file content
        const jamContent = await fs.promises.readFile(jamFilePath, 'utf8');
        if (!jamContent.trim()) {
            log('INFO', 'latest-jam.json is empty, skipping update.');
            return;
        }

        // 3. Validate JSON
        try {
            JSON.parse(jamContent);
        } catch (err) {
            log('INFO', 'latest-jam.json contains invalid JSON, skipping update.');
            return;
        }
        
        // 4. Prepare and make Gist API request
        const options = {
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            method: 'PATCH',
headers: { 'User-Agent': 'Gist-Updater', 'Content-Type': 'application/json', 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' }
        };
        const data = JSON.stringify({ files: { 'latest-jam.json': { content: jamContent } } });

        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                await new Promise((resolve, reject) => {
                    const req = https.request(options, res => {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            if (res.statusCode === 200) {
                                log('SUCCESS', 'Signal compass aligned.');
                                lastUpdateTime = Date.now();
                                resolve();
                            } else if (res.statusCode === 403 && body.includes('rate limit')) {
                                // Handle rate limit specifically
                                log('WARN', 'GitHub API rate limit reached. Will retry later.');
                                lastUpdateTime = Date.now(); // Prevent immediate retries
                                reject(new Error(`Rate limit exceeded`));
                            } else {
                                reject(new Error(`API Error: ${res.statusCode} - ${body}`));
                            }
                        });
                    });
                    req.on('error', reject);
                    req.write(data);
                    req.end();
                });
                return; // Success, exit the retry loop
            } catch (err) {
                log('WARN', `Gist update attempt ${i + 1} of ${MAX_RETRIES} failed.`);
                if (i === MAX_RETRIES - 1) {
                    throw err; // Rethrow last error
                }
                await sleep(RETRY_DELAY);
            }
        }
    } catch (error) {
        log('ERROR', 'Gist update process failed', error);
    } finally {
        isUpdating = false;
        log('INFO', 'Gist update process finished.');
    }
}

// --- Main Execution ---
let isRunning = false;
function main() {
    if (isRunning) return;
    isRunning = true;
    const jamFilePath = path.join(__dirname, 'latest-jam.json');

    // Ensure the file exists
    if (!fs.existsSync(jamFilePath)) {
        log('INIT', 'Created empty latest-jam.json file.');
        fs.writeFileSync(jamFilePath, '{}\n');
    }

// Trigger update on file change (with debounce)
    let debounceTimeout = null;
    let updateQueue = [];
    
    fs.watch(jamFilePath, (eventType, filename) => {
        if (eventType === 'change') {
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }
            
            const now = Date.now();
            updateQueue.push(now);
            
            // Remove old entries from queue (older than 1 hour)
            updateQueue = updateQueue.filter(time => now - time < 3600000);
            
            // If too many updates in recent time, skip
            if (updateQueue.length > 10) {
                log('WARN', 'Too many updates recently. Skipping to avoid rate limits.');
                return;
            }
            
            log('INFO', 'JAM signal change detected. Debouncing...');
            debounceTimeout = setTimeout(() => {
                log('INFO', 'Debounce timer finished. Triggering update.');
                updateGist();
            }, DEBOUNCE_DELAY);
        }
    });

    // Initial update
    log('INFO', 'Performing initial Gist update.');
    updateGist();

    console.log('[READY] Signal compass alignment active.');
}

main();

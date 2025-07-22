const fs = require('fs');
const path = require('path');

// Ensure log directories exist
const logDirs = [
  './logs/cache',
  './logs/utils'
];

logDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

module.exports = {
  apps: [
    {
      name: 'semantic-engine', // The Causal Engine
      script: './index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '60s',
      max_memory_restart: '300M',
      error_file: './logs/cache/engine-err.log',
      out_file: './logs/cache/engine-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
        VAULT_ADDRESS: process.env.VAULT_ADDRESS,
        ERROR_LOGGING: process.env.ERROR_LOGGING || 'minimal',
        SUPPRESS_DISABLED_FEATURES: 'true',
// --- Oracle Config ---
        // Required for substrate analysis
        TARGET_CONTRACT_ADDRESS: process.env.TARGET_CONTRACT_ADDRESS || '',
        // Optional decompiler settings - will use local analysis if not provided
        DECOMPILER_API_URL: process.env.DECOMPILER_API_URL || 'https://api.evmdecompiler.com/decompile',
        DECOMPILER_API_KEY: process.env.DECOMPILER_API_KEY || '',
        // --- System Config ---
        DETECT_INTERVAL: process.env.DETECT_INTERVAL || 60000,
        MAX_GAS_GWEI: process.env.MAX_GAS_GWEI || 0.02,
        // --- Cross-Chain Config ---
        ENABLE_BSV_ECHO: process.env.ENABLE_BSV_ECHO || 'true',
        BSV_PRIVATE_KEY: process.env.BSV_PRIVATE_KEY,
      }
    },
    {
      name: 'semantic-amplifier', // Deterministic Executor
      script: './semantic-amplifier.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/amplifier-err.log',
      out_file: './logs/cache/amplifier-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
        MIRROR_PRIVATE_KEY: process.env.MIRROR_PRIVATE_KEY,
        ERROR_LOGGING: process.env.ERROR_LOGGING || 'minimal',
        SUPPRESS_DISABLED_FEATURES: 'true',
        WALLET_ADDRESS: process.env.WALLET_ADDRESS, // Required for listener
        VAULT_ADDRESS: process.env.VAULT_ADDRESS,
      }
    },
    {
      name: 'semantic-mirror', // Deterministic Executor
      script: './mirror.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/mirror-err.log',
      out_file: './logs/cache/mirror-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        PRIVATE_KEY: process.env.PRIVATE_KEY, // For reading wallet address
        MIRROR_PRIVATE_KEY: process.env.MIRROR_PRIVATE_KEY,
        WALLET_ADDRESS: process.env.WALLET_ADDRESS, // Required for listener
        VAULT_ADDRESS: process.env.VAULT_ADDRESS,
      }
    },
    {
      name: 'monitor', // System Monitor
      script: './monitor.js',
      cwd: __dirname,
      autorestart: true,
      watch: ['./latest-jam.json', './substrate-cache.json'],
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/monitor-err.log',
      out_file: './logs/cache/monitor-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      }
    },
    {
      name: 'gist-updater',
      script: './update-gist.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/gist-updater-err.log',
      out_file: './logs/cache/gist-updater-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        GIST_ID: process.env.GIST_ID,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN
      }
    }
  ]
};

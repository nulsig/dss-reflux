const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// --- Utility Functions ---
const log = (message, color = 'reset') => {
    console.log(colors[color] + message + colors.reset);
};

const executeCommand = (command, live = false) => {
    if (live) {
        return new Promise((resolve, reject) => {
            const child = require('child_process').spawn(command, { shell: true, stdio: 'inherit' });
            child.on('close', code => code === 0 ? resolve() : reject(new Error(`Command exited with code ${code}`)))
            child.on('error', err => reject(err));
        });
    }
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) return reject(error);
            resolve({ stdout, stderr });
        });
    });
};

const getVaultContract = async () => {
    const vaultAbiPath = path.join(__dirname, 'artifacts/contracts/SignalVault.sol/SignalVault.json');
    if (!fs.existsSync(vaultAbiPath)) {
        throw new Error('Missing ABI file. Run `npx hardhat compile` first.');
    }
    const vaultAbi = require(vaultAbiPath).abi;
    
    const { RPC_URL, PRIVATE_KEY, VAULT_ADDRESS } = process.env;
    if (!RPC_URL || !PRIVATE_KEY || !VAULT_ADDRESS) {
        throw new Error('Missing required environment variables (RPC_URL, PRIVATE_KEY, VAULT_ADDRESS).');
    }

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    return new ethers.Contract(VAULT_ADDRESS, vaultAbi, wallet);
};

// --- Command Handlers ---

const pm2Command = (action, component, flags = '') => async () => {
    const componentName = component || (action === 'stop' ? 'all' : 'ecosystem.config.js');
    const friendlyName = component || 'system';
    log(`${action.charAt(0).toUpperCase() + action.slice(1)}ing ${friendlyName}...`, 'yellow');
    try {
        await executeCommand(`pm2 ${action} ${componentName} ${flags}`);
        log(`${friendlyName} ${action}ed successfully.`, 'green');
    } catch (error) {
        log(`Failed to ${action} ${friendlyName}: ${error.message}`, 'red');
    }
};

const commands = {
    start: pm2Command('start'),
    stop: pm2Command('stop'),
    restart: pm2Command('restart', null, '--update-env'),

    async status() {
        log('System Status', 'cyan');
        try {
            const { stdout } = await executeCommand('pm2 list');
            console.log(stdout);
        } catch (error) {
            log('Failed to get pm2 status: ' + error.message, 'red');
        }
    },

    async test() {
        log('Running system alignment test...', 'cyan');
        try {
            await executeCommand('npx hardhat test', true);
            log('Tests completed.', 'green');
        } catch (error) {
            log('Test run failed.', 'red');
        }
    },

    async logs(args) {
        const component = args[0] || '';
        const lines = args[1] || '100';
        log(`Showing logs for: ${component || 'all services'}`, 'cyan');
        try {
            await executeCommand(`pm2 logs ${component} --lines ${lines}`, true);
        } catch (error) {
            // Error is handled by live output, just need to catch promise rejection
        }
    },

    async clean() {
        log('Cleaning logs and temporary files...', 'yellow');
        try {
            await executeCommand('pm2 flush');
            log('PM2 logs flushed.', 'green');
        } catch (error) {
            log('Failed to clean logs: ' + error.message, 'red');
        }
    },

    async monitor() {
        log('Starting live monitor... (Ctrl+C to exit)', 'cyan');
        try {
            await executeCommand('node monitor.js', true);
        } catch (error) {
            log('Monitor process exited.', 'yellow');
        }
    },

    async 'set-lz-endpoint'(args) {
        const [endpointAddress] = args;
        if (!endpointAddress) return log('Usage: node manage.js set-lz-endpoint <address>', 'red');
        log(`Setting LayerZero endpoint to: ${endpointAddress}`, 'cyan');
        try {
            const vault = await getVaultContract();
            const tx = await vault.setLayerZeroEndpoint(endpointAddress);
            log(`Transaction sent: ${tx.hash}`, 'yellow');
            await tx.wait();
            log('LayerZero endpoint set successfully!', 'green');
        } catch (error) {
            log(`Failed to set endpoint: ${error.message}`, 'red');
        }
    },

    async 'add-lz-remote'(args) {
        const [chainId, remoteAddress] = args;
        if (!chainId || !remoteAddress) return log('Usage: node manage.js add-lz-remote <chainId> <address>', 'red');
        log(`Adding remote for chain ${chainId}: ${remoteAddress}`, 'cyan');
        try {
            const vault = await getVaultContract();
            const tx = await vault.setRemote(chainId, remoteAddress);
            log(`Transaction sent: ${tx.hash}`, 'yellow');
            await tx.wait();
            log('Remote added successfully!', 'green');
        } catch (error) {
            log(`Failed to add remote: ${error.message}`, 'red');
        }
    },

    async 'bridge-yield'(args) {
        const [chainId, toAddress, amount] = args;
        if (!chainId || !toAddress || !amount) return log('Usage: node manage.js bridge-yield <chainId> <toAddress> <amount>', 'red');
        log(`Bridging ${amount} yield to ${toAddress} on chain ${chainId}...`, 'cyan');
        try {
            const vault = await getVaultContract();
            const lzFee = ethers.utils.parseEther("0.01"); // Example fee
            const tx = await vault.withdrawYieldToChain(chainId, toAddress, ethers.utils.parseEther(amount), { value: lzFee });
            log(`Transaction sent: ${tx.hash}`, 'yellow');
            await tx.wait();
            log('Yield bridged successfully!', 'green');
        } catch (error) {
            log(`Failed to bridge yield: ${error.message}`, 'red');
        }
    },

    help() {
        log('System Management Command Center', 'bright');
        const helpText = [
            ['start', 'Start all services via ecosystem config.'],
            ['stop', 'Stop all running services.'],
            ['restart', 'Restart all services and reload environment variables.'],
            ['status', 'Display status of all running services.'],
            ['logs [service]', 'Tail logs for all services or a specific one.'],
            ['test', 'Run the Hardhat test suite.'],
            ['monitor', 'Run the live monitor script directly.'],
            ['clean', 'Flush all logs.'],
            ['set-lz-endpoint <addr>', 'Set LayerZero endpoint on SignalVault.'],
            ['add-lz-remote <id> <addr>', 'Add a trusted remote for SignalVault.'],
            ['bridge-yield <id> <addr> <amt>', 'Bridge yield from SignalVault.'],
            ['help', 'Show this help message.']
        ];
        console.log('');
        helpText.forEach(([cmd, desc]) => {
            console.log(`  ${colors.green}${cmd.padEnd(30)}${colors.reset} ${desc}`);
        });
        console.log('\n');
    }
};
// Main execution loop
const main = async () => {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    const commandArgs = args.slice(1);

    if (commands[command]) {
        await commands[command](commandArgs);
    } else {
        log(`Unknown command: ${command}`, 'red');
        commands.help();
    }
};

main().catch(error => {
    log(`Fatal Error: ${error.message}`, 'red');
    process.exit(1);
});

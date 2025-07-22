// hardhat.config.js
require("dotenv").config();
require("@nomiclabs/hardhat-ethers");

module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
        details: {
          yul: true,
          yulDetails: {
            stackAllocation: true,
            optimizerSteps: "dhfoDgvulfnTUtnIf"
          }
        }
      },
      viaIR: true
    },
  },
  networks: {
    base: {
      url: process.env.BASE_RPC_URL || process.env.RPC_URL,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453,
      verify: {
        etherscan: {
          apiUrl: 'https://api.basescan.org'
        }
      },
      gas: 'auto',
      gasPrice: 'auto',
      gasMultiplier: 1.1,
      timeout: 60000
    },
  },
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};


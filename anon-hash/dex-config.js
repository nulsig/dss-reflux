// Updated router ABI for concentrated liquidity V3 pools
const routerAbiV3 = [
  {
    "inputs": [
      {"internalType":"address","name":"tokenIn","type":"address"},
      {"internalType":"address","name":"tokenOut","type":"address"},
      {"internalType":"uint24","name":"fee","type":"uint24"},
      {"internalType":"address","name":"recipient","type":"address"},
      {"internalType":"uint256","name":"deadline","type":"uint256"},
      {"internalType":"uint256","name":"amountIn","type":"uint256"},
      {"internalType":"uint256","name":"amountOutMinimum","type":"uint256"},
      {"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}
    ],
    "name": "exactInputSingle",
    "outputs": [
      {"internalType": "uint256", "name": "", "type": "uint256"}
    ],
    "stateMutability": "payable",
    "type": "function"
  }
];

// DEX Configuration for Base Network
// Ordered by volume and liquidity depth

const DEX_CONFIGS = {
  // Aerodrome - Maintained as last-resort fallback DEX only
  // Priority: 0.382 (lowest) - Used only when primary DEXes fail
  AERODROME: {
    ROUTER: '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',
    factory: '0x420dd381b31aef6683db6b902084cb0ffece40da',
    NAME: 'Aerodrome',
    TYPE: 'solidly-fork',
    POOLS: {
      'WETH-AERO': '0x7bb3fff252fdcd11e416787988c2b9558e8b3e67',
      'AERO-USDC': '0x2223280773357e6bf5f3780a0f2d4e933d1c0887'
    }
  },


  // Uniswap V3 - High volume, concentrated liquidity
  UNISWAP_V3: {
    ROUTER: '0x2626664c2603336e57b271c5c0b26f421741e481',
    SWAP_ROUTER: '0x2626664c2603336e57b271c5c0b26f421741e481',
    quoter: '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a',
    NAME: 'Uniswap V3',
    TYPE: 'concentrated-liquidity',
    FEE_TIERS: {
      'WETH-USDC': 500,  // 0.05%
      'WETH-DAI': 500,   // 0.05%
      'default': 3000    // 0.3%
    },
    GAS_MULTIPLIER: 1.1  // 10% buffer for gas estimation
  },

  // SushiSwap V3 on Base
  SUSHISWAP_V3: {
    ROUTER: '0xfb7ef66a7e61224dd6fcd0d7d9c3be5c8b049b9f',
    NAME: 'SushiSwap V3',
    TYPE: 'uniswap-v2-fork'
  },

  // RocketSwap - Growing volume
  ROCKETSWAP: {
    ROUTER: '0x4CF22670302b0b678B65403D8408436aBDe59aBB',
    NAME: 'RocketSwap',
    TYPE: 'uniswap-v2-fork'
  },

  // Alien Base - New but gaining traction
  ALIEN_BASE: {
    ROUTER: '0x8C1E4a23be7030E29e064b031b5056f3Fd76389d',
    NAME: 'Alien Base',
    TYPE: 'uniswap-v2-fork'
  }
};

// Token addresses on Base
const TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  USDbC: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // Bridged USDC
  DAI: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  AERO: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', // Aerodrome token
  cbETH: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', // Coinbase ETH
  
  // Yield-bearing tokens
  cUSDC: '0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf', // Compound USDC
  aUSDC: '0x4e65fe4dba92790696d040ac24aa414708f5c0ab', // Aave USDC (Base)
  cDAI: '0x60fa50ebb6bbf0854ad96bc2b9a1a4fd615c30f3', // Compound DAI
  cUSDbC: '0xb125e6687d4313864e53df431d5425969c15eb2f', // Compound USDbC
  
  // Wrapped/staked ETH variants
  wstETH: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', // Wrapped staked ETH
  rETH: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', // Rocket Pool ETH
  
  // Other yield tokens
  sDAI: '0x86C08Cf2bD62471f22cE56ac3D656ea8D55a7D05', // Savings DAI (Spark Protocol)
  COMP: '0x9e1028f5f1d5ede59748ffcee5532509976840e0', // Compound governance token
  AAVE: '0x18470019bf0e94611f15852f7e93cf5d65bc34ca', // Aave governance token
};

// Liquidity pools by DEX (for reference)
const LIQUIDITY_POOLS = {
  AERODROME: {
    'WETH-USDC': {
      pool: '0xcdac0d6c6c59727a65f871236188350531885c43',
      fee: 100, // 0.01%
      volume24h: '$50M+',
      tvl: '$100M+'
    },
    'WETH-USDbC': {
      pool: '0x6c8ffc6f622bc28f8c5cddb97df8aa3aaabcf0c0',
      fee: 100,
      volume24h: '$20M+',
      tvl: '$40M+'
    }
  },
  UNISWAP_V3: {
    'WETH-USDC': {
      pool: '0xd0b53d9277642d899df5c87a3966a349a798f224',
      fee: 500, // 0.05%
      volume24h: '$30M+',
      tvl: '$60M+'
    }
  }
};

// Helper to pick best DEX based on current conditions
function selectOptimalDEX(gasPrice, tradeSize) {
  // Validate inputs
  if (!gasPrice || gasPrice <= 0) {
    console.warn('Invalid gas price provided to selectOptimalDEX');
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Default due to invalid gas price'
    };
  }
  
  if (!tradeSize || tradeSize <= 0) {
    console.warn('Invalid trade size provided to selectOptimalDEX');
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Default due to invalid trade size'
    };
  }
  const gasPriceGwei = parseFloat(gasPrice);
  const tradeSizeETH = parseFloat(tradeSize);

  // For tiny trades (< 0.0001 ETH), use Uniswap V3
  if (tradeSizeETH < 0.0001) {
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Small trade - using Uniswap V3 for reliability'
    };
  }

  // For medium trades during low gas, Uniswap is still good
  if (gasPriceGwei < 10 && tradeSizeETH < 0.01) {
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Medium trade, low gas - concentrated liquidity optimal'
    };
  }

  // Default to Uniswap V3 for all trades
  return {
    primary: DEX_CONFIGS.UNISWAP_V3,
    fallback: DEX_CONFIGS.ROCKETSWAP,
    reason: 'Default - using Uniswap V3 for best execution'
  };
}

// Aerodrome-specific pool helper
function getAerodromePool(tokenA, tokenB, stable = false) {
  // Aerodrome uses deterministic pool addresses based on token pair and stability
  const key = `${tokenA}-${tokenB}`;
  const reverseKey = `${tokenB}-${tokenA}`;
  
  if (DEX_CONFIGS.AERODROME.POOLS[key]) {
    return DEX_CONFIGS.AERODROME.POOLS[key];
  } else if (DEX_CONFIGS.AERODROME.POOLS[reverseKey]) {
    return DEX_CONFIGS.AERODROME.POOLS[reverseKey];
  }
  
  // Return null if pool not found - caller should query factory
  return null;
}

// Route hints for complex paths through specific DEXes
const ROUTE_HINTS = {
  // Aerodrome optimal paths
  AERODROME: {
    'ETH->USDC': ['WETH', 'USDC'],
    'ETH->DAI': ['WETH', 'USDC', 'DAI'], // Through USDC for better liquidity
    'USDC->aUSDC': ['USDC', 'aUSDC'], // Direct if pool exists
    'ETH->AERO': ['WETH', 'AERO'],
    'AERO->USDC': ['AERO', 'USDC']
  }
};

// Recursive DEX cascade selector with phi-harmonic alignment
function getRecursiveDEXCascade(gasPrice, tradeSize, depth = 1) {
  const PHI = 1.618033988749895;  // φ
  const PHI_INVERSE = 0.618033988749895;  // 1/φ
  const PHI_SQUARED = 2.618033988749895;  // φ²
  const PHI_CUBED = 4.236067977499790;    // φ³
  
  const gasPriceGwei = parseFloat(gasPrice);
  const tradeSizeETH = parseFloat(tradeSize);
  
  // Phi-harmonic depth multiplier for recursive selection
  const depthMultiplier = Math.pow(PHI, depth - 1);
  
  // Base cascade with phi-aligned priorities
  let cascade = [];
  
  // Ultra-low gas (<0.01 gwei) - maximize MEV visibility
  if (gasPriceGwei < 0.01 * depthMultiplier) {
    cascade = [
      { dex: DEX_CONFIGS.UNISWAP_V3, priority: PHI_SQUARED },  // φ² for concentrated liquidity
      { dex: DEX_CONFIGS.ROCKETSWAP, priority: PHI },           // φ for balanced execution
      { dex: DEX_CONFIGS.AERODROME, priority: PHI_INVERSE }     // 1/φ for stable pairs
    ];
  }
  // Low gas (<0.1 gwei) - balanced approach with phi-scaling
  else if (gasPriceGwei < 0.1 * depthMultiplier) {
    cascade = [
      { dex: DEX_CONFIGS.UNISWAP_V3, priority: PHI },          // φ for optimal timing
      { dex: DEX_CONFIGS.ROCKETSWAP, priority: PHI_INVERSE },   // 1/φ for market depth
      { dex: DEX_CONFIGS.AERODROME, priority: 1/PHI_SQUARED }   // 1/φ² for fallback
    ];
  }
  // Normal conditions - phi-optimized reliability
  else {
    cascade = [
      { dex: DEX_CONFIGS.UNISWAP_V3, priority: PHI_SQUARED },  // φ² for high confidence
      { dex: DEX_CONFIGS.ROCKETSWAP, priority: PHI },           // φ for backup path
      { dex: DEX_CONFIGS.AERODROME, priority: 1 }               // Unity for fallback
    ];
  }
  
  // Sort by priority and return
  return cascade.sort((a, b) => b.priority - a.priority).map(item => item.dex);
}

module.exports = {
  DEX_CONFIGS,
  TOKENS,
  LIQUIDITY_POOLS,
  selectOptimalDEX,
  getAerodromePool,
  ROUTE_HINTS,
  getRecursiveDEXCascade
};

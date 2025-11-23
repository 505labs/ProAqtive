# SwapVM Compatible DODO Implementation

This directory contains a hackathon-ready implementation of DODO's Proactive Market Maker (PMM) algorithm compatible with SwapVM architecture.

## Quick Start

1. **Main Contract**: `DODOSwap.sol` - Full PMM implementation with SwapVM compatibility
2. **Oracle**: `MockOracle.sol` - Testing oracle (replace with Pyth in production)
3. **Documentation**: `DODOSWAP_README.md` - Complete usage guide

## Key Features

- ✅ Full DODO PMM algorithm with k parameter
- ✅ Oracle-based pricing (Pyth-compatible interface)
- ✅ All three R states (ONE, ABOVE_ONE, BELOW_ONE)
- ✅ SwapVM Context integration
- ✅ Stateless design (parameters via calldata)

## Architecture

```
DODOSwap.sol           # Main swap implementation
├── libs/
│   ├── DecimalMath.sol    # Fixed-point math (18 decimals)
│   ├── DODOMath.sol       # PMM quadratic formulas
│   └── Types.sol          # Type definitions
├── interfaces/
│   └── IPriceOracle.sol   # Oracle interface
└── MockOracle.sol     # Testing oracle
```

## Compiler Requirement

**Solidity 0.8.30** required (update `truffle-config.js` or use Hardhat/Foundry)

## Usage Example

```solidity
// Setup context (from SwapVM)
Context memory ctx;
ctx.swap.balanceIn = 1000e18;
ctx.swap.balanceOut = 2000e18;
ctx.swap.amountIn = 10e18;
ctx.query.isExactIn = true;

// Setup DODO parameters
DODOParams memory params = DODOParams({
    oracle: oracleAddress,
    k: 0.1e18,  // 10% liquidity depth
    targetBaseAmount: 1000e18,
    targetQuoteAmount: 2000e18,
    rStatus: Types.RStatus.ONE
});

// Execute swap
_dodoSwapXD(ctx, abi.encode(params));
// Result in ctx.swap.amountOut
```

See `DODOSWAP_README.md` for detailed documentation.


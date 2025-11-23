# DODOSwap - SwapVM Compatible Implementation

A streamlined DODO Proactive Market Maker (PMM) implementation compatible with SwapVM architecture, designed for hackathon rapid prototyping.

## Overview

This implementation provides the full DODO PMM algorithm with k parameter and oracle-based pricing, stripped of production features like admin controls, LP tokens, and complex state management for quick integration.

## Architecture

### Files Created

```
DODOSwap.sol              # Main swap contract with PMM pricing
libs/
  ├── DecimalMath.sol     # Fixed-point math (18 decimals)
  ├── DODOMath.sol        # PMM quadratic formulas
  └── Types.sol           # Type definitions
interfaces/
  └── IPriceOracle.sol    # Oracle interface (Pyth-compatible)
```

## Compiler Version

**Important**: These contracts require Solidity 0.8.30. To compile:

### Option 1: Update Truffle Config
Modify `truffle-config.js`:
```javascript
compilers: {
  solc: {
    version: "0.8.30",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
}
```

### Option 2: Use Hardhat
Create `hardhat.config.js`:
```javascript
module.exports = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
};
```

### Option 3: Use Foundry
```bash
forge build --contracts DODOSwap.sol
```

## How to Use

### 1. Context Integration

The swap function follows SwapVM pattern:

```solidity
function _dodoSwapXD(Context memory ctx, bytes calldata args) internal view
```

**Context Structure** (from SwapVM):
- `ctx.swap.balanceIn`: Current pool reserve of input token
- `ctx.swap.balanceOut`: Current pool reserve of output token
- `ctx.swap.amountIn`: Input amount (set if exactIn, calculated if exactOut)
- `ctx.swap.amountOut`: Output amount (calculated if exactIn, set if exactOut)
- `ctx.query.isExactIn`: Direction flag

### 2. Parameters (via args)

Encode DODOParams struct:

```solidity
struct DODOParams {
    address oracle;              // Price oracle address
    uint256 k;                   // Liquidity depth (0 to 1e18)
    uint256 targetBaseAmount;    // Target base balance
    uint256 targetQuoteAmount;   // Target quote balance
    Types.RStatus rStatus;       // Pool state (ONE, ABOVE_ONE, BELOW_ONE)
}
```

**K Parameter**:
- `k = 0`: Constant sum (no slippage)
- `k = 1e18`: Constant product (maximum slippage)
- `k = 0.1e18` (10%): Recommended for stable pairs
- `k = 0.5e18` (50%): Recommended for volatile pairs

**R Status**:
- `ONE`: Pool is balanced (base/quote ratio matches oracle)
- `BELOW_ONE`: Excess base tokens (more base than target)
- `ABOVE_ONE`: Excess quote tokens (more quote than target)

### 3. Example Usage

```solidity
// Prepare context (normally done by SwapVM)
Context memory ctx;
ctx.swap.balanceIn = 1000e18;   // 1000 base tokens
ctx.swap.balanceOut = 2000e18;  // 2000 quote tokens
ctx.swap.amountIn = 10e18;      // Swap 10 base tokens
ctx.query.isExactIn = true;

// Prepare parameters
DODOParams memory params = DODOParams({
    oracle: 0x...,              // Your Pyth oracle address
    k: 0.1e18,                  // 10% liquidity depth
    targetBaseAmount: 1000e18,
    targetQuoteAmount: 2000e18,
    rStatus: Types.RStatus.ONE
});

// Encode and execute
bytes memory args = abi.encode(params);
_dodoSwapXD(ctx, args);

// Result: ctx.swap.amountOut contains the output amount
```

## Oracle Integration

### Mock Oracle (for testing)

```solidity
contract MockOracle is IPriceOracle {
    uint256 private _price;
    
    constructor(uint256 initialPrice) {
        _price = initialPrice;
    }
    
    function getPrice() external view returns (uint256) {
        return _price;
    }
    
    function setPrice(uint256 newPrice) external {
        _price = newPrice;
    }
}
```

### Pyth Oracle Integration

```solidity
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract PythOracle is IPriceOracle {
    IPyth public pyth;
    bytes32 public priceId;
    
    constructor(address _pyth, bytes32 _priceId) {
        pyth = IPyth(_pyth);
        priceId = _priceId;
    }
    
    function getPrice() external view returns (uint256) {
        PythStructs.Price memory pythPrice = pyth.getPriceUnsafe(priceId);
        
        // Convert Pyth price to 18 decimals
        uint256 price = uint256(uint64(pythPrice.price));
        int32 expo = pythPrice.expo;
        
        if (expo >= 0) {
            return price * (10 ** uint32(expo)) * 1e18;
        } else {
            return (price * 1e18) / (10 ** uint32(-expo));
        }
    }
}
```

**Pyth Price Feed IDs** (examples):
- ETH/USD: `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`
- BTC/USD: `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
- SOL/USD: `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`

## PMM Algorithm

### How It Works

DODO uses a Proactive Market Maker (PMM) algorithm that concentrates liquidity near the oracle price:

1. **Oracle Price**: External price feed (e.g., Pyth) provides market price
2. **Target Balances**: Equilibrium point where pool is balanced
3. **K Parameter**: Controls liquidity concentration (0 = flat, 1 = curved)
4. **R Status**: Tracks pool state relative to equilibrium

### Price Curve

```
Price = OraclePrice * (1 - k + k * (Target²/Balance²))
```

When k=0, price = oracle price (constant sum)
When k=1, price follows x*y=k curve (constant product)

### State Transitions

- **R = ONE**: Balanced → Use quadratic formula
- **R < ONE**: Too much base → Cheaper to buy base
- **R > ONE**: Too much quote → Cheaper to buy quote

## Testing

### Unit Test Example

```javascript
const DODOSwap = artifacts.require("DODOSwap");
const MockOracle = artifacts.require("MockOracle");

contract("DODOSwap", accounts => {
    it("should calculate correct output", async () => {
        const oracle = await MockOracle.new(web3.utils.toWei("2", "ether"));
        
        // Test exact input swap
        const ctx = {
            swap: {
                balanceIn: web3.utils.toWei("1000", "ether"),
                balanceOut: web3.utils.toWei("2000", "ether"),
                amountIn: web3.utils.toWei("10", "ether"),
                amountOut: 0
            },
            query: {
                isExactIn: true
            }
        };
        
        const params = {
            oracle: oracle.address,
            k: web3.utils.toWei("0.1", "ether"),
            targetBaseAmount: web3.utils.toWei("1000", "ether"),
            targetQuoteAmount: web3.utils.toWei("2000", "ether"),
            rStatus: 0 // ONE
        };
        
        // Call and verify
        const result = await dodoSwap._dodoSwapXD(ctx, abi.encode(params));
        assert(result.swap.amountOut > 0);
    });
});
```

## Key Simplifications from Production DODO

- ✅ Full PMM algorithm with k parameter
- ✅ All R states (ONE, ABOVE_ONE, BELOW_ONE)
- ✅ Oracle-based pricing
- ✅ Quadratic pricing formulas
- ❌ No LP token minting/burning
- ❌ No admin controls
- ❌ No liquidity provider management
- ❌ No fees/incentives distribution
- ❌ Stateless (state passed via args)

## Dependencies

Required imports in your project:
- SwapVM infrastructure: `libs/VM.sol` with `Context` and `ContextLib`
- OpenZeppelin (optional, for Math utils)

## License

Apache-2.0 (matching original DODO license)

## Support

For hackathon support:
1. Check that VM.sol exists with Context struct
2. Ensure compiler is set to 0.8.30
3. Deploy mock oracle for testing
4. Start with k=0.1e18 for testing

## Example Deployment Script

```javascript
// 1. Deploy oracle
const oracle = await MockOracle.new(web3.utils.toWei("2", "ether"));

// 2. Deploy DODOSwap
const dodoSwap = await DODOSwap.new();

// 3. Initialize params
const params = {
    oracle: oracle.address,
    k: web3.utils.toWei("0.1", "ether"),
    targetBaseAmount: web3.utils.toWei("1000", "ether"),
    targetQuoteAmount: web3.utils.toWei("2000", "ether"),
    rStatus: 0
};

console.log("DODOSwap deployed at:", dodoSwap.address);
console.log("Oracle deployed at:", oracle.address);
```

## Next Steps for Production

1. Add liquidity management functions
2. Implement fee collection
3. Add LP token minting/burning
4. Implement admin controls
5. Add emergency pause
6. Integrate real Pyth oracle
7. Add comprehensive testing
8. Security audit


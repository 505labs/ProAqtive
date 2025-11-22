# Scripts Summary

## Created Scripts

I've created a complete set of scripts for interacting with deployed contracts on Sepolia (or any network):

### Core Scripts

1. **`check-balances.ts`** - Check token balances and deployed contract addresses
2. **`build-order.ts`** - Build a ProAquativeAMM order
3. **`ship-liquidity.ts`** - Deposit tokens into Aqua with an order
4. **`get-quote.ts`** - Get a quote for a swap (without executing)
5. **`execute-swap.ts`** - Execute a swap using a deployed order
6. **`full-workflow-example.ts`** - Complete workflow demonstration

### Helper Utilities

- **`utils/helpers.ts`** - Common utilities:
  - `getDeployedAddress()` - Get deployed contract address
  - `getDeployedContract()` - Get contract instance
  - `formatTokenAmount()` - Format token amounts for display
  - `parseTokenAmount()` - Parse token amounts from strings
  - `waitForTx()` - Wait for transaction and log details
  - `displayBalance()` - Display token balance

## How They Work

### Loading Deployed Contracts

All scripts use `hardhat-deploy` to automatically load deployed contract addresses:

```typescript
const swapVM = await getDeployedContract<CustomSwapVMRouter>("CustomSwapVMRouter");
```

This reads from `deployments/<network>/CustomSwapVMRouter.json`

### Environment Variables

Scripts use environment variables for configuration:
- Token addresses
- Amounts
- Order parameters
- File paths for saved orders

### Order Management

Orders can be:
- Built on-the-fly with parameters
- Saved to JSON files
- Loaded from JSON files for reuse

## Usage Examples

### Basic Workflow

```bash
# 1. Check your setup
npx hardhat run scripts/check-balances.ts --network sepolia

# 2. Build an order
PYTH_ORACLE=0x... PRICE_ID=0x... npx hardhat run scripts/build-order.ts --network sepolia > order.json

# 3. Ship liquidity
TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 ORDER_FILE=order.json \
  npx hardhat run scripts/ship-liquidity.ts --network sepolia

# 4. Get a quote
TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=order.json \
  npx hardhat run scripts/get-quote.ts --network sepolia

# 5. Execute swap
TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=order.json \
  npx hardhat run scripts/execute-swap.ts --network sepolia
```

### Or Use the Complete Workflow Script

```bash
TOKEN0=0x... TOKEN1=0x... PYTH_ORACLE=0x... PRICE_ID=0x... \
  npx hardhat run scripts/full-workflow-example.ts --network sepolia
```

## Key Features

✅ **Automatic contract loading** - Uses hardhat-deploy to find deployed contracts  
✅ **Environment variable support** - Configure via env vars  
✅ **Order persistence** - Save/load orders as JSON  
✅ **Balance checking** - Always shows balances before/after  
✅ **Transaction logging** - Shows gas used, block numbers, etc.  
✅ **Error handling** - Clear error messages with suggestions  
✅ **Quote preview** - Get quotes before executing swaps  

## Documentation

- **`README.md`** - Complete documentation with all options
- **`QUICK_REFERENCE.md`** - Quick command reference
- **`SUMMARY.md`** - This file

## Next Steps

1. Deploy contracts to Sepolia
2. Get token addresses (or deploy test tokens)
3. Get Pyth oracle address and price feed ID
4. Run the scripts to interact with your contracts!

All scripts are ready to use! 🚀


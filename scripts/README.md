# Interaction Scripts for Deployed Contracts

These scripts allow you to interact with deployed contracts on Sepolia (or any network).

## Prerequisites

1. **Deploy contracts first:**
   ```bash
   npx hardhat deploy --tags ProAquativeAMM --network sepolia
   ```

2. **Set up environment variables:**
   ```bash
   # .env file
   PRIVATE_KEY=your_key
   SEPOLIA_RPC_URL=your_rpc_url
   ETHERSCAN_API_KEY=your_key
   ```

3. **Have tokens ready:**
   - You need ERC20 tokens deployed on the network
   - Or use existing tokens (like testnet tokens)

## Available Scripts

### 1. `check-balances.ts` - Check Balances and Addresses

Quick script to check your balances and see deployed contract addresses.

Check token balances and view deployed contract addresses.

```bash
# Check your balance
npx hardhat run scripts/check-balances.ts --network sepolia

# Check specific tokens
TOKEN0=0x... TOKEN1=0x... npx hardhat run scripts/check-balances.ts --network sepolia

# Check different address
ADDRESS=0x... TOKEN0=0x... npx hardhat run scripts/check-balances.ts --network sepolia
```

### 2. `build-order.ts` - Build a ProAquativeAMM Order

Build an order that can be used to ship liquidity or execute swaps.

```bash
# Build with defaults
npx hardhat run scripts/build-order.ts --network sepolia

# Build with custom parameters
PYTH_ORACLE=0x... PRICE_ID=0x... K=500000000000000000 npx hardhat run scripts/build-order.ts --network sepolia
```

**Environment Variables:**
- `PYTH_ORACLE` - Pyth oracle address
- `PRICE_ID` - Price feed ID (bytes32)
- `K` - k parameter (default: 500000000000000000 = 0.5)
- `MAX_STALENESS` - Max price age in seconds (default: 3600)
- `IS_TOKEN_IN_BASE` - true/false (default: true)
- `BASE_DECIMALS` - Base token decimals (default: 18)
- `QUOTE_DECIMALS` - Quote token decimals (default: 18)

### 3. `ship-liquidity.ts` - Ship Liquidity to Aqua

Deposit tokens into Aqua with an order.

```bash
# Ship liquidity (will build order automatically)
TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 npx hardhat run scripts/ship-liquidity.ts --network sepolia

# Use a previously built order
ORDER_FILE=order.json TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

**Environment Variables:**
- `TOKEN0` or `TOKEN0_ADDRESS` - First token address
- `TOKEN1` or `TOKEN1_ADDRESS` - Second token address
- `AMOUNT0` - Amount of token0 to deposit
- `AMOUNT1` - Amount of token1 to deposit
- `ORDER_FILE` - (Optional) JSON file with order data
- All order parameters (same as build-order.ts)

### 4. `get-quote.ts` - Get Swap Quote

Get a quote for a swap without executing it.

```bash
# Get quote
TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=order.json npx hardhat run scripts/get-quote.ts --network sepolia
```

**Environment Variables:**
- Same as `execute-swap.ts`
- `IS_EXACT_IN` - true/false (default: true)

### 5. `execute-swap.ts` - Execute a Swap

Execute a swap using a deployed order.

```bash
# Execute swap (will build order automatically)
TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 npx hardhat run scripts/execute-swap.ts --network sepolia

# Use a previously built order
ORDER_FILE=order.json TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 npx hardhat run scripts/execute-swap.ts --network sepolia
```

**Environment Variables:**
- `TOKEN_IN` or `TOKEN_IN_ADDRESS` - Input token address
- `TOKEN_OUT` or `TOKEN_OUT_ADDRESS` - Output token address
- `AMOUNT_IN` - Amount to swap
- `THRESHOLD` - Minimum output (default: 0)
- `ORDER_FILE` - (Optional) JSON file with order data
- `MAKER_ADDRESS` - (Optional) Maker address if building new order
- All order parameters (same as build-order.ts)

### 6. `full-workflow-example.ts` - Complete Workflow

Run the complete workflow: build order → ship liquidity → get quote → execute swap.

```bash
TOKEN0=0x... TOKEN1=0x... PYTH_ORACLE=0x... PRICE_ID=0x... npx hardhat run scripts/full-workflow-example.ts --network sepolia
```

**Environment Variables:**
- `TOKEN0`, `TOKEN1` - Token addresses
- `LIQUIDITY0`, `LIQUIDITY1` - Liquidity amounts (default: 100, 200)
- `SWAP_AMOUNT` - Amount to swap (default: 10)
- All order parameters

## Example Workflow

### Step 1: Check Your Setup

```bash
# Check balances and deployed addresses
npx hardhat run scripts/check-balances.ts --network sepolia
```

### Step 2: Build an Order

```bash
# Build order with your parameters
PYTH_ORACLE=0xYourPythOracle \
PRICE_ID=0xYourPriceId \
K=500000000000000000 \
npx hardhat run scripts/build-order.ts --network sepolia > order.json
```

### Step 3: Ship Liquidity

```bash
# Ship liquidity with the order
TOKEN0=0xYourToken0 \
TOKEN1=0xYourToken1 \
AMOUNT0=100 \
AMOUNT1=200 \
ORDER_FILE=order.json \
npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

### Step 4: Execute Swaps

```bash
# Execute a swap
TOKEN_IN=0xYourToken0 \
TOKEN_OUT=0xYourToken1 \
AMOUNT_IN=10 \
ORDER_FILE=order.json \
npx hardhat run scripts/execute-swap.ts --network sepolia
```

## Saving and Loading Orders

Orders can be saved to JSON files and reused:

```bash
# Save order
npx hardhat run scripts/build-order.ts --network sepolia > order.json

# Use saved order
ORDER_FILE=order.json npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

## Tips

1. **Use environment files**: Create `.env.sepolia` for Sepolia-specific values
2. **Check balances first**: Always verify you have enough tokens before swapping
3. **Start small**: Test with small amounts first
4. **Save orders**: Save built orders to avoid rebuilding them
5. **Check gas**: Make sure you have enough ETH for gas fees

## Troubleshooting

### "Contract not deployed"

Make sure you've deployed contracts:
```bash
npx hardhat deploy --tags ProAquativeAMM --network sepolia
```

### "Insufficient balance"

Check your token balances:
```bash
TOKEN0=0x... TOKEN1=0x... npx hardhat run scripts/check-balances.ts --network sepolia
```

### "Allowance insufficient"

The scripts automatically approve tokens, but if it fails, manually approve:
```typescript
await token.approve(aquaAddress, ethers.MaxUint256);
```

### "Order not found"

Make sure liquidity has been shipped:
```bash
npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

## Network-Specific Notes

### Sepolia Testnet

- Get testnet tokens from faucets
- Contracts are verified on Etherscan
- Use Sepolia ETH for gas

### Mainnet

- Use real tokens
- Be careful with amounts
- Higher gas costs


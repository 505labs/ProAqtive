# Quick Start: Deploying ProAquativeAMM

## TL;DR

```bash
# Deploy to localhost
yarn deploy:proaquative:localhost

# Deploy to Sepolia
yarn deploy:proaquative sepolia

# Or use hardhat directly
npx hardhat deploy --tags ProAquativeAMM --network sepolia
```

## What Gets Deployed

1. **Aqua** (if not exists) - Liquidity management
2. **CustomSwapVMRouter** - Router with ProAquativeMM instruction
3. **ProAquativeAMM** - Your AMM builder contract
4. **FixedPriceAMM** - Bonus: Fixed price AMM
5. **SimpleConstantProductAMM** - Bonus: Constant product AMM

## Prerequisites

1. **Environment Setup**
   ```bash
   # .env file
   PRIVATE_KEY=your_key
   SEPOLIA_RPC_URL=your_rpc_url
   ETHERSCAN_API_KEY=your_key  # For verification
   ```

2. **Compile Contracts**
   ```bash
   npx hardhat compile
   ```

## Deployment Commands

### Localhost (Testing)

```bash
# Start local node
npx hardhat node

# In another terminal
yarn deploy:proaquative:localhost
```

### Sepolia Testnet

```bash
yarn deploy:proaquative sepolia
```

### Custom Network

```bash
npx hardhat deploy --tags ProAquativeAMM --network <network_name>
```

## After Deployment

You'll see output like:

```
=== ProAquativeAMM Deployment Summary ===
Aqua: 0x5FbDB2315678afecb367f032d93F642f64180aa3
CustomSwapVMRouter: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
ProAquativeAMM: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
==========================================
```

**Save these addresses!** You'll need them to interact with the contracts.

## Using the Deployed Contracts

### 1. Get Contract Instance

```typescript
import { ProAquativeAMM } from './typechain-types/contracts/ProAquativeAMM';

const proAquativeAMM = await ethers.getContractAt(
  "ProAquativeAMM",
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" // Your deployed address
);
```

### 2. Build an Order

```typescript
const order = await proAquativeAMM.buildProgram(
  makerAddress,
  pythOracleAddress,
  priceId,
  500000000000000000n,  // k = 0.5
  3600n,                 // maxStaleness = 1 hour
  true,                  // isTokenInBase
  18,                    // baseDecimals
  18                     // quoteDecimals
);
```

### 3. Ship Liquidity

```typescript
await aqua.connect(maker).ship(
  customSwapVMRouterAddress,
  encodedOrder,
  [token0Address, token1Address],
  [amount0, amount1]
);
```

### 4. Execute Swap

```typescript
await customSwapVMRouter.connect(taker).swap(
  order,
  tokenIn,
  tokenOut,
  amountIn,
  takerData
);
```

## Important Notes

- **CustomSwapVMRouter is required** - Don't use standard AquaSwapVMRouter
- **Same opcodes** - ProAquativeAMM and CustomSwapVMRouter must use same opcodes
- **Pyth Oracle** - You need a Pyth oracle address and price feed ID

## Troubleshooting

**"Aqua not found"** → Deploy Aqua first or let the script deploy it

**"Out of gas"** → Increase gas limit or deploy separately

**"Verification failed"** → Wait 30+ seconds, check API key, or verify manually

For more details, see `docs/DEPLOYMENT_GUIDE.md`


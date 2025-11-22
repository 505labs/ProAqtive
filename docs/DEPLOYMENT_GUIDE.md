# Deployment Guide for SwapVM Contracts

## Overview

This guide explains how to deploy SwapVM contracts, specifically focusing on ProAquativeAMM and related custom contracts.

## Deployment Architecture

### Core Components

1. **Aqua** - Liquidity management protocol
2. **CustomSwapVMRouter** - SwapVM router with custom opcodes (includes ProAquativeMM instruction)
3. **ProAquativeAMM** - AMM builder contract for ProAquativeMM swaps
4. **FixedPriceAMM** - Simple fixed price AMM (optional)
5. **SimpleConstantProductAMM** - Constant product AMM (optional)

### Deployment Order

The contracts must be deployed in this order:

```
1. Aqua (if not already deployed)
   ↓
2. CustomSwapVMRouter (needs Aqua address)
   ↓
3. ProAquativeAMM (needs Aqua address)
```

## Deployment Scripts

### Script 1: `deploy-aqua.ts`

Deploys the standard Aqua setup:
- Aqua
- AquaAMM
- AquaSwapVMRouter (standard, without custom opcodes)
- MockTaker (for testing)

**Usage:**
```bash
npx hardhat deploy --network <network> --tags Aqua
# or
yarn deploy <network>
```

### Script 2: `deploy-proaquative.ts` (NEW)

Deploys ProAquativeAMM and custom contracts:
- Aqua (if not already deployed)
- CustomSwapVMRouter (with ProAquativeMM instruction)
- ProAquativeAMM
- FixedPriceAMM
- SimpleConstantProductAMM

**Usage:**
```bash
npx hardhat deploy --network <network> --tags ProAquativeAMM
```

## Step-by-Step Deployment

### Prerequisites

1. **Environment Setup**
   ```bash
   # Install dependencies
   yarn install
   
   # Compile contracts
   npx hardhat compile
   ```

2. **Network Configuration**
   
   Create/update `.env` file:
   ```env
   PRIVATE_KEY=your_private_key_here
   SEPOLIA_RPC_URL=your_sepolia_rpc_url
   ETHERSCAN_API_KEY=your_etherscan_api_key
   ```

3. **Hardhat Network Config**
   
   The `hardhat.config.ts` should have your network configured:
   ```typescript
   networks: {
     sepolia: {
       url: process.env.SEPOLIA_RPC_URL,
       accounts: [process.env.PRIVATE_KEY],
     }
   }
   ```

### Deployment Steps

#### Option 1: Deploy Everything Together

```bash
# Deploy all ProAquativeAMM contracts
npx hardhat deploy --network sepolia --tags ProAquativeAMM
```

This will:
1. Check if Aqua exists, deploy if not
2. Deploy CustomSwapVMRouter
3. Deploy ProAquativeAMM
4. Deploy FixedPriceAMM (optional)
5. Deploy SimpleConstantProductAMM (optional)
6. Verify contracts on Etherscan (if not localhost)

#### Option 2: Deploy Standard Aqua First, Then Custom

```bash
# Step 1: Deploy standard Aqua setup
npx hardhat deploy --network sepolia --tags Aqua

# Step 2: Deploy ProAquativeAMM (will use existing Aqua)
npx hardhat deploy --network sepolia --tags ProAquativeAMM
```

#### Option 3: Deploy to Local Network

```bash
# Start local node
npx hardhat node

# In another terminal, deploy
npx hardhat deploy --network localhost --tags ProAquativeAMM
```

## What Gets Deployed

### CustomSwapVMRouter

**Constructor Args:**
- `aqua`: Address of Aqua contract
- `name`: "CustomSwapVM"
- `version`: "1.0.0"

**Why it's needed:**
- Uses `MyCustomOpcodes` which includes ProAquativeMM instruction
- Standard `AquaSwapVMRouter` doesn't have custom opcodes
- Must match the opcodes used by ProAquativeAMM

### ProAquativeAMM

**Constructor Args:**
- `aqua`: Address of Aqua contract

**What it does:**
- Builder contract that creates SwapVM orders
- Uses ProAquativeMM instruction (opcode 0x1E)
- Makers call `buildProgram()` to create orders

## Post-Deployment

### 1. Verify Contracts

Contracts are automatically verified on Etherscan (for non-local networks) after deployment.

If verification fails, you can manually verify:

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

Example:
```bash
npx hardhat verify --network sepolia \
  0x1234... \
  "0x5678..." # Aqua address
```

### 2. Check Deployment

Deployment addresses are saved in `deployments/<network>/` directory.

You can also check the console output for addresses.

### 3. Test the Deployment

You can interact with deployed contracts:

```typescript
// Get deployed contract
const ProAquativeAMM = await ethers.getContractAt(
  "ProAquativeAMM",
  deployedAddress
);

// Build an order
const order = await ProAquativeAMM.buildProgram(
  makerAddress,
  pythOracleAddress,
  priceId,
  k,
  maxStaleness,
  isTokenInBase,
  baseDecimals,
  quoteDecimals
);
```

## Deployment Checklist

- [ ] Environment variables configured (`.env`)
- [ ] Network configured in `hardhat.config.ts`
- [ ] Contracts compiled (`npx hardhat compile`)
- [ ] Sufficient balance for gas fees
- [ ] Deploy Aqua (if not exists)
- [ ] Deploy CustomSwapVMRouter
- [ ] Deploy ProAquativeAMM
- [ ] Verify contracts on Etherscan
- [ ] Save deployment addresses
- [ ] Test deployed contracts

## Common Issues

### Issue: "Aqua not found"

**Solution:** Deploy Aqua first:
```bash
npx hardhat deploy --network <network> --tags Aqua
```

### Issue: Verification fails

**Solution:** 
- Wait longer (30+ seconds after deployment)
- Check Etherscan API key is correct
- Manually verify using `npx hardhat verify`

### Issue: Out of gas

**Solution:**
- Increase gas limit in `hardhat.config.ts`
- Or deploy contracts separately

### Issue: Custom opcodes mismatch

**Solution:**
- Ensure `CustomSwapVMRouter` uses `MyCustomOpcodes`
- Ensure `ProAquativeAMM` uses `MyCustomOpcodes`
- They must have the same opcodes array

## Network-Specific Notes

### Localhost/Hardhat

- No verification needed
- Fast deployment
- Good for testing

### Sepolia Testnet

- Requires Sepolia ETH for gas
- Contracts verified on Etherscan
- Good for testing on testnet

### Mainnet

- Requires real ETH for gas
- Expensive deployment
- Production use only

## Example Deployment Output

```
Deploying ProAquativeAMM contracts with account: 0x1234...
Using existing Aqua at: 0x5678...
CustomSwapVMRouter deployed at: 0x9abc...
ProAquativeAMM deployed at: 0xdef0...
FixedPriceAMM deployed at: 0x1111...
SimpleConstantProductAMM deployed at: 0x2222...

=== ProAquativeAMM Deployment Summary ===
Aqua: 0x5678...
CustomSwapVMRouter: 0x9abc...
ProAquativeAMM: 0xdef0...
FixedPriceAMM: 0x1111...
SimpleConstantProductAMM: 0x2222...
==========================================

Waiting for block confirmations...
Verifying contracts...
CustomSwapVMRouter verified
ProAquativeAMM verified
FixedPriceAMM verified
SimpleConstantProductAMM verified
```

## Next Steps After Deployment

1. **Configure Pyth Oracle**
   - Deploy or use existing Pyth oracle
   - Get price feed IDs for your token pairs

2. **Create Orders**
   - Makers call `ProAquativeAMM.buildProgram()` with parameters
   - Ship liquidity to Aqua with the order

3. **Execute Swaps**
   - Takers call `CustomSwapVMRouter.swap()` with the order
   - SwapVM executes the ProAquativeMM program

## Summary

- **Deployment**: Use `deploy-proaquative.ts` script
- **Order**: Aqua → CustomSwapVMRouter → ProAquativeAMM
- **Verification**: Automatic on Etherscan (non-local networks)
- **Testing**: Use deployed addresses to interact with contracts

The deployment script handles all the complexity - just run it and you're ready to use ProAquativeAMM!


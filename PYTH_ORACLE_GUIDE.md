# Pyth Oracle Integration Guide

This guide explains how to use Pyth Network oracles with your DODOSwap implementation on Sepolia testnet.

## Overview

The implementation includes:
- **Oracle.sol**: Wrapper contract for Pyth price feeds with IPriceOracle interface
- **update-pyth-price.ts**: Script to fetch and update prices from Hermes API
- **execute-swap-with-oracle.ts**: Complete swap workflow with price updates
- **deploy-oracle.ts**: Deployment script for Oracle contract

## 🔧 Setup

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Key configuration for Sepolia:**

```env
# Your private key
PRIVATE_KEY=your_private_key_here

# Sepolia RPC
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_api_key

# Pyth Oracle on Sepolia
PYTH_ADDRESS=0xDd24F84d36BF92C65F92307595335bdFab5Bbd21

# ETH/USD Price Feed ID
PRICE_ID=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

# Or use price pair
PRICE_PAIR=ETH/USD

# Maximum price staleness (60 seconds)
MAX_STALENESS=60

# Hermes API (Pyth's price service)
HERMES_URL=https://hermes.pyth.network
```

## 📍 Pyth Network Addresses

### Sepolia Testnet
- **Pyth Oracle**: `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21`

### Mainnet (when ready)
- **Pyth Oracle**: `0x4305FB66699C3B2702D4d05CF36551390A4c69C6`

## 🔑 Common Price Feed IDs

| Pair | Price Feed ID |
|------|--------------|
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` |
| USDT/USD | `0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b` |

Full list: https://pyth.network/developers/price-feed-ids

## 🚀 Deployment & Usage

### Step 1: Deploy Oracle Contract

```bash
# Deploy with default settings (ETH/USD, 60s staleness)
npx hardhat deploy --tags Oracle --network sepolia

# Or with custom settings
PRICE_ID=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43 \
MAX_STALENESS=120 \
npx hardhat deploy --tags Oracle --network sepolia
```

This will output your Oracle contract address. Save it to `.env`:

```env
ORACLE_ADDRESS=0x...
```

### Step 2: Update Price from Hermes API

Before using the oracle, you need to update it with fresh price data:

```bash
# Update price for your deployed oracle
ORACLE_ADDRESS=0x... \
npx hardhat run scripts/update-pyth-price.ts --network sepolia

# Or use different price feed
ORACLE_ADDRESS=0x... \
PRICE_PAIR=BTC/USD \
npx hardhat run scripts/update-pyth-price.ts --network sepolia
```

**What happens:**
1. Script fetches signed price update from Hermes API
2. Submits update to Pyth oracle (pays small fee in ETH)
3. Your Oracle contract now has fresh price data

### Step 3: Ship Liquidity with Oracle

```bash
# Ship liquidity using your oracle
ORACLE_ADDRESS=0x... \
TOKEN0_ADDRESS=0x... \
TOKEN1_ADDRESS=0x... \
AMOUNT0=1000 \
AMOUNT1=1000 \
npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

This creates a DODOSwap order that uses your Pyth oracle for pricing.

### Step 4: Execute Swaps

```bash
# Execute swap with automatic price update
ORACLE_ADDRESS=0x... \
TOKEN0_ADDRESS=0x... \
TOKEN1_ADDRESS=0x... \
SWAP_AMOUNT=100 \
MIN_AMOUNT_OUT=95 \
npx hardhat run scripts/execute-swap-with-oracle.ts --network sepolia
```

## 🔄 How Pyth Oracle Works

### Architecture

```
Hermes API (Pyth Price Service)
    ↓ (fetch signed price updates)
Your Script (update-pyth-price.ts)
    ↓ (call updatePrice())
Pyth Oracle Contract (on Sepolia)
    ↓ (verified price data)
Your Oracle Wrapper (Oracle.sol)
    ↓ (implements IPriceOracle)
DODOSwap (DODOSwap.sol)
    ↓ (uses price for swaps)
Your Users
```

### Price Update Flow

1. **Fetch from Hermes**: Hermes API provides signed price updates
   ```typescript
   GET https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xff61...
   ```

2. **Submit to Pyth**: Your script calls `updatePrice()` with signed data
   ```solidity
   oracle.updatePrice(updateData, { value: fee });
   ```

3. **Verify & Store**: Pyth oracle verifies signatures and stores price

4. **Read Price**: Your Oracle wrapper reads and converts price
   ```solidity
   function getPrice() external view returns (uint256) {
       PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(priceId, maxStaleness);
       return convertToUint256(pythPrice);
   }
   ```

### Price Format Conversion

Pyth returns prices with an exponent:
- **Example**: `price = 300000`, `expo = -8` → $3.00
- **Our conversion**: Scales to 18 decimals → `3000000000000000000`

```solidity
// Oracle.sol handles conversion automatically
if (expo >= 0) {
    return price * (10 ** expo) * 1e18;
} else {
    uint32 absExpo = uint32(-expo);
    if (absExpo <= 18) {
        return price * (10 ** (18 - absExpo));
    } else {
        return price / (10 ** (absExpo - 18));
    }
}
```

## 🧪 Testing

### With Real Pyth Oracle (Sepolia)

```bash
# Deploy oracle
npx hardhat deploy --tags Oracle --network sepolia

# Update price
ORACLE_ADDRESS=0x... npx hardhat run scripts/update-pyth-price.ts --network sepolia

# Run DODOSwap tests (will use real prices)
npx hardhat test test/DODOSwap.test.ts --network sepolia
```

### With Mock Oracle (Local/Testing)

```bash
# Unit tests use MockPriceOracle
npx hardhat test test/DODOSwap.test.ts
```

## 🔐 Security Considerations

### Price Staleness
- Always set appropriate `maxStaleness` (default: 60s)
- Update prices before critical operations
- Handle `StalePrice` errors gracefully

### Update Fees
- Pyth charges small fee per update (~0.0001 ETH on testnet)
- Ensure sufficient ETH balance
- Consider batching updates for multiple feeds

### Price Validation
- Oracle validates price > 0
- Checks signature verification via Pyth
- Enforces staleness limits

## 📚 Advanced Usage

### Custom Price Feeds

Deploy oracle for any Pyth price feed:

```bash
# BTC/USD oracle
PRICE_ID=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43 \
npx hardhat deploy --tags Oracle --network sepolia

# SOL/USD oracle  
PRICE_ID=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d \
npx hardhat deploy --tags Oracle --network sepolia
```

### Multiple Oracles

Deploy separate oracles for different pairs:

```bash
# ETH/USD oracle
PRICE_PAIR=ETH/USD npx hardhat deploy --tags Oracle --network sepolia
# Save address as ORACLE_ETH_USD=0x...

# BTC/USD oracle
PRICE_PAIR=BTC/USD npx hardhat deploy --tags Oracle --network sepolia
# Save address as ORACLE_BTC_USD=0x...
```

### Automated Price Updates

For production, automate price updates using a cron job or keeper:

```typescript
// keeper.ts
setInterval(async () => {
    await updateOraclePrice(oracleAddress, priceId);
}, 30000); // Update every 30 seconds
```

### Read Price in Contracts

```solidity
import { IPriceOracle } from "./interfaces/IPriceOracle.sol";

contract MyContract {
    IPriceOracle public oracle;
    
    constructor(address _oracle) {
        oracle = IPriceOracle(_oracle);
    }
    
    function getCurrentPrice() public view returns (uint256) {
        return oracle.getPrice(); // Returns price scaled to 18 decimals
    }
}
```

## 🐛 Troubleshooting

### "No price available yet"
**Problem**: Oracle deployed but never updated
**Solution**: Run `update-pyth-price.ts` to fetch initial price

### "Stale price" error
**Problem**: Price too old (> maxStaleness)
**Solution**: Update price more frequently or increase `maxStaleness`

### "Insufficient balance" for update
**Problem**: Not enough ETH to pay Pyth update fee
**Solution**: Fund your wallet with testnet ETH (faucet: https://sepoliafaucet.com)

### Hermes API errors
**Problem**: Failed to fetch price from Hermes
**Solution**: 
- Check network connection
- Verify price feed ID is correct
- Try alternative Hermes endpoint

### Price seems wrong
**Problem**: Price conversion error
**Solution**: Check `getRawPrice()` to see original Pyth price struct

```typescript
const rawPrice = await oracle.getRawPrice();
console.log(`Price: ${rawPrice.price}, Expo: ${rawPrice.expo}`);
```

## 📖 Resources

- [Pyth Network Documentation](https://docs.pyth.network/)
- [Price Feed IDs](https://pyth.network/developers/price-feed-ids)
- [Hermes API Reference](https://hermes.pyth.network/docs)
- [Pyth Contract Addresses](https://docs.pyth.network/price-feeds/contract-addresses/evm)

## 🎯 Quick Reference

```bash
# Complete workflow from scratch
npx hardhat deploy --tags Oracle --network sepolia
ORACLE_ADDRESS=0x... npx hardhat run scripts/update-pyth-price.ts --network sepolia
ORACLE_ADDRESS=0x... npx hardhat run scripts/ship-liquidity.ts --network sepolia
ORACLE_ADDRESS=0x... npx hardhat run scripts/execute-swap.ts --network sepolia

# Update price before swap
ORACLE_ADDRESS=0x... npx hardhat run scripts/update-pyth-price.ts --network sepolia

# Check current price
npx hardhat console --network sepolia
> const oracle = await ethers.getContractAt("Oracle", "0x...")
> const price = await oracle.getPrice()
> console.log(ethers.formatEther(price))
```


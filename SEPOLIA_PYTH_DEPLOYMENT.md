# Sepolia Pyth Integration - Complete Deployment & Testing Guide

## 🔄 What Changed?

Your contracts were updated to support **real Pyth oracle integration**:

### 1. **DODOSwap.sol** - Updated Architecture
- ✅ **NEW**: Reads price directly from Pyth contract
- ✅ **REMOVED**: `priceUpdateData` from `DODOParams` struct
- ✅ **CLEANER**: Price update happens BEFORE swap, not during

**New DODOParams struct:**
```solidity
struct DODOParams {
    address pythContract;      // Pyth oracle address
    bytes32 priceFeedId;       // ETH/USD feed ID
    uint256 maxStaleness;      // Max price age (e.g., 60s)
    uint256 k;                 // Liquidity parameter
    uint256 targetBaseAmount;  // Target base balance
    uint256 targetQuoteAmount; // Target quote balance
    bool baseIsTokenIn;        // Swap direction
    // priceUpdateData REMOVED!
}
```

### 2. **CustomSwapVMRouter.sol** (MyCustomOpcodes Router)
- ✅ **NEW**: Can receive ETH via `receive()` and `fallback()`
- ✅ **PURPOSE**: Hold ETH for paying Pyth update fees
- ✅ **NEW**: `withdrawETH()` function for admin

**New Flow:**
```
1. User/Bot calls pyth.updatePriceFeeds(priceData) → Pays fee in ETH
2. Pyth contract verifies signature and updates price
3. User calls router.swap() → DODOSwap reads updated price from Pyth
```

---

## 📋 Prerequisites

### 1. Environment Setup

Create/update `.env` file:

```env
# Your wallet private key (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Sepolia RPC URL
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Etherscan API key (for verification)
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### 2. Get Sepolia ETH

You'll need Sepolia ETH for:
- Deploying contracts (~0.1 ETH)
- Updating Pyth prices (~0.0001 ETH per update)
- Executing swaps (gas fees)

**Faucets:**
- https://sepoliafaucet.com
- https://www.alchemy.com/faucets/ethereum-sepolia

---

## 🚀 Step-by-Step Deployment

### Step 1: Redeploy MyCustomOpcodes Router ✅ DONE

The router was updated to accept ETH for Pyth fees:

```bash
npx hardhat deploy --tags MyCustomOpcodes --network sepolia
```

**✅ Deployed at:** `0xd3f73AC6D27A7496A7dD1B9D87b2b6723307452b`

This new router includes:
- ✅ Updated DODOSwap (reads price from Pyth)
- ✅ `receive()` function to accept ETH
- ✅ Custom opcodes: 0x1C (FixedPriceSwap), 0x1D (DODOSwap)

### Step 2: Deploy Test Tokens (if needed)

If you don't have tokens deployed yet:

```bash
npx hardhat deploy --tags TestTokens --network sepolia
```

This deploys:
- `TokenMock0` (mETH)
- `TokenMock1` (mUSDC)

### Step 3: Deploy Aqua (if needed)

If you need a fresh Aqua instance:

```bash
npx hardhat deploy --tags Aqua --network sepolia
```

### Step 4: Verify Deployments

Check your `deployments/sepolia/` folder for:
- ✅ `MyCustomOpcodes.json` (new/updated)
- ✅ `Aqua.json`
- ✅ `TokenMock0.json` (mETH)
- ✅ `TokenMock1.json` (mUSDC)

---

## 🧪 Step-by-Step Integration Test

### Step 1: Run the Complete Integration Test

This script does EVERYTHING automatically:
1. Mints tokens if needed
2. Approves tokens
3. Fetches REAL price from Pyth Hermes API
4. Updates Pyth oracle
5. Ships liquidity
6. Executes swap
7. Verifies results

```bash
npx hardhat run scripts/test-sepolia-pyth-integration.ts --network sepolia
```

### Expected Output:

```
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     🧪 SEPOLIA PYTH INTEGRATION TEST 🧪                    ║
║    Real Pyth Oracle + DODOSwap on Sepolia                 ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

═══ 📋 Setup Information ═══
Deployer: 0xabc...
ETH Balance: 1.5 ETH
Network: Sepolia
Pyth Contract: 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21
Hermes API: https://hermes.pyth.network

═══ 📦 Loading Contracts ═══
✅ Aqua: 0x1A2...
✅ MyCustomOpcodes Router: 0x3Fd...
✅ mETH: 0xC2F...
✅ mUSDC: 0xA74...
✅ Pyth Oracle: 0xDd2...

═══ 🌐 Step 3: Fetch Real-Time Price from Pyth ═══
📊 Current ETH/USD Price (from Pyth):
   Price: $3456.78
   Confidence: ±$1.23
   Published: 2025-11-23T10:30:45.000Z

📡 Fetching REAL price update from Pyth Hermes API...
✅ Fetched 1 signed price update(s)

═══ 💵 Step 4: Calculate Pyth Fee ═══
Pyth Update Fee: 0.0001 ETH
(This is paid to Pyth for price verification)

═══ 🔄 Step 6: Update Pyth Price Feed ═══
Updating Pyth price feed with fresh data...
⏳ Update Pyth price feed...
✅ Update Pyth price feed confirmed (Block 12345678)

✅ Pyth price updated! Now DODOSwap can read the fresh price.

═══ 🔨 Step 7: Build DODOSwap Order ═══
DODO Parameters:
  Pyth Contract: 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21
  Price Feed: ETH/USD (0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace)
  Max Staleness: 60s
  K Parameter: 0.1
  Target Base: 3.0 mETH
  Target Quote: 8445.0 mUSDC
  Initial Price: ~$2815.00

✅ Order built successfully

═══ 🚢 Step 8: Ship Liquidity to Aqua ═══
Order Hash: 0xabc...
📤 Shipping liquidity...
⏳ Dock 10.0 mETH...
✅ Dock 10.0 mETH confirmed (Block 12345679)
⏳ Dock 30000.0 mUSDC...
✅ Dock 30000.0 mUSDC confirmed (Block 12345680)
✅ Liquidity shipped successfully!

═══ 🔄 Step 10: Execute Swap (Uses Updated Pyth Price) ═══
Swapping 0.5 mETH for mUSDC...
⏳ Execute swap...
✅ Execute swap confirmed (Block 12345681)

═══ 📈 Step 11: Results ═══
Balance Changes:
  mETH: -0.5
  mUSDC: +1728.12

Actual Price Paid: $3456.24 per mETH
Price Deviation: -0.02%

Transaction: https://sepolia.etherscan.io/tx/0xabc...
Gas Used: 234567

╔════════════════════════════════════════════════════════════╗
║                                                            ║
║            ✅ INTEGRATION TEST SUCCESSFUL! ✅              ║
║                                                            ║
║  DODOSwap is working with REAL Pyth oracle on Sepolia!    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## 📊 Manual Testing (Step-by-Step)

If you want to test components individually:

### 1. Update Pyth Price Manually

```bash
npx hardhat run scripts/update-pyth-price.ts --network sepolia
```

### 2. Ship Liquidity with Custom Amounts

```bash
# Edit scripts/ship-dodoswap-liquidity.ts with your parameters
npx hardhat run scripts/ship-dodoswap-liquidity.ts --network sepolia
```

### 3. Execute Individual Swap

```bash
# Edit scripts/execute-swap.ts with your order hash
npx hardhat run scripts/execute-swap.ts --network sepolia
```

---

## 🔍 Verification

### Verify Contracts on Etherscan

After deployment, verify your contracts:

```bash
# Verify MyCustomOpcodes
npx hardhat verify --network sepolia <MYCUSTOMOPCODES_ADDRESS> \
  "<AQUA_ADDRESS>" \
  "MyCustomOpcodes" \
  "1.0"

# Verify Tokens
npx hardhat verify --network sepolia <TOKEN_ADDRESS> \
  "Mock ETH" \
  "mETH"
```

### Check on Sepolia Etherscan

- **Your transactions**: https://sepolia.etherscan.io/address/YOUR_ADDRESS
- **Pyth Oracle**: https://sepolia.etherscan.io/address/0xDd24F84d36BF92C65F92307595335bdFab5Bbd21
- **Price Feed Explorer**: https://pyth.network/developers/price-feed-ids

---

## 🐛 Troubleshooting

### Error: "Stale price"

**Problem**: Price is too old (> 60 seconds)

**Solution**: Update price before swap:
```bash
npx hardhat run scripts/update-pyth-price.ts --network sepolia
```

### Error: "Insufficient balance for Pyth fee"

**Problem**: Not enough ETH to pay Pyth update fee (~0.0001 ETH)

**Solution**: Get more testnet ETH from faucet

### Error: "Failed to fetch from Hermes API"

**Problem**: Network issue or Hermes API down

**Solution**: 
- Check internet connection
- Retry after a few seconds
- Verify price feed ID is correct

### Error: "Transaction reverted"

**Problem**: Various causes (liquidity, slippage, etc.)

**Solution**:
1. Check you have liquidity in the pool
2. Verify price was updated recently
3. Check token balances and approvals
4. Enable hardhat-tracer for detailed logs:
   ```bash
   npx hardhat run scripts/test-sepolia-pyth-integration.ts --network sepolia --trace
   ```

---

## 📝 Key Addresses

### Sepolia Pyth Network

| Contract | Address |
|----------|---------|
| Pyth Oracle | `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` |
| Hermes API | `https://hermes.pyth.network` |

### Price Feed IDs

| Pair | Feed ID |
|------|---------|
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |

Full list: https://pyth.network/developers/price-feed-ids

---

## 🎯 Summary

### What You Need to Redeploy:

1. ✅ **MyCustomOpcodes** (CustomSwapVMRouter) - Updated to accept ETH
2. ❌ **DODOSwap** - Embedded in MyCustomOpcodes, redeployed automatically
3. ❌ **Aqua** - Can reuse existing deployment
4. ❌ **Tokens** - Can reuse existing deployment

### Testing Workflow:

```bash
# 1. Ensure environment is configured
cat .env  # Check PRIVATE_KEY and SEPOLIA_RPC_URL

# 2. Redeploy router if needed
npx hardhat deploy --tags MyCustomOpcodes --network sepolia

# 3. Run complete integration test
npx hardhat run scripts/test-sepolia-pyth-integration.ts --network sepolia

# 4. Monitor on Etherscan
# Check transactions at: https://sepolia.etherscan.io/address/YOUR_ADDRESS
```

### Success Criteria:

- ✅ Price fetched from real Pyth Hermes API
- ✅ Pyth oracle updated with signed price data
- ✅ DODOSwap reads fresh price from Pyth
- ✅ Swap executes successfully
- ✅ Output amount matches expected (based on Pyth price)
- ✅ All transactions confirmed on Sepolia

---

## 📚 Additional Resources

- [Pyth Network Docs](https://docs.pyth.network/)
- [Hermes API Reference](https://hermes.pyth.network/docs)
- [Price Feed IDs](https://pyth.network/developers/price-feed-ids)
- [Sepolia Faucets](https://sepoliafaucet.com)
- [Your Project Guide](./PYTH_ORACLE_GUIDE.md)

---

**Ready to test? Run:**

```bash
npx hardhat run scripts/test-sepolia-pyth-integration.ts --network sepolia
```

Good luck! 🚀


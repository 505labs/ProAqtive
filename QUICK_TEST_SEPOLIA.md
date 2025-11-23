# Quick Start: Sepolia Pyth Integration Test

## TL;DR - Just Run This

```bash
# 1. Redeploy the updated router (required!)
npx hardhat deploy --tags MyCustomOpcodes --network sepolia

# 2. Run complete integration test with REAL Pyth oracle
npx hardhat run scripts/test-sepolia-pyth-integration.ts --network sepolia
```

That's it! The test script handles everything automatically. ✨

---

## What Changed?

Your contracts were updated for **real Pyth integration**:

1. **DODOSwap.sol** - Now reads price directly from Pyth (cleaner architecture)
2. **CustomSwapVMRouter.sol** - Can receive ETH for Pyth fees

**You need to redeploy MyCustomOpcodes to use the updated contracts!**

---

## What the Test Does

The integration test script automatically:

1. ✅ Fetches **REAL** ETH/USD price from Pyth Hermes API
2. ✅ Updates Sepolia Pyth oracle with signed price data
3. ✅ Mints test tokens (if needed)
4. ✅ Approves tokens for Aqua
5. ✅ Ships liquidity to create DODOSwap pool
6. ✅ Executes swap using real Pyth price
7. ✅ Verifies results and shows price deviation

---

## Prerequisites

1. **Sepolia ETH**: Get from https://sepoliafaucet.com (~0.1 ETH needed)
2. **Environment configured**: Check `.env` has:
   - `PRIVATE_KEY` (your wallet private key, no 0x prefix)
   - `SEPOLIA_RPC_URL` (Alchemy/Infura Sepolia endpoint)

---

## Expected Result

```
╔════════════════════════════════════════════════════════════╗
║            ✅ INTEGRATION TEST SUCCESSFUL! ✅              ║
║  DODOSwap is working with REAL Pyth oracle on Sepolia!    ║
╚════════════════════════════════════════════════════════════╝

Balance Changes:
  mETH: -0.5
  mUSDC: +1728.12

Actual Price Paid: $3456.24 per mETH
Price Deviation: -0.02%

Transaction: https://sepolia.etherscan.io/tx/0x...
```

---

## Troubleshooting

**"Insufficient ETH"** → Get more from faucet: https://sepoliafaucet.com

**"Stale price"** → Price updated automatically by script

**"Failed to fetch"** → Check internet connection, retry

**Need help?** → See full guide: `SEPOLIA_PYTH_DEPLOYMENT.md`

---

Ready? Go! 🚀

```bash
npx hardhat deploy --tags MyCustomOpcodes --network sepolia
npx hardhat run scripts/test-sepolia-pyth-integration.ts --network sepolia
```


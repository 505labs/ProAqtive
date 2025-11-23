# Sepolia Deployment Summary

## 🎉 Deployment Complete!

All contracts have been successfully deployed to Sepolia testnet with DODOSwap functionality and realistic ETH/USDC pricing.

## 📊 Deployed Contracts

### Test Tokens
- **mETH (Mock ETH)**: `0xC2FB82498d61e136a1d5Dd66Dc5095f4C3aCcbBD`
  - Symbol: mETH
  - Decimals: 18
  - Initial Supply: 10,000 tokens minted to deployer
  - Etherscan: https://sepolia.etherscan.io/address/0xC2FB82498d61e136a1d5Dd66Dc5095f4C3aCcbBD

- **mUSDC (Mock USDC)**: `0xA748Cef1c4E68Cc81448bD061A4aF8FEaD9d5558`
  - Symbol: mUSDC
  - Decimals: 18 (simplified for testing)
  - Initial Supply: 10,000 tokens minted to deployer
  - Etherscan: https://sepolia.etherscan.io/address/0xA748Cef1c4E68Cc81448bD061A4aF8FEaD9d5558

### Oracle
- **Oracle Contract**: `0xB0d9Fe62FEc791bc8e4428bCE47605fF3b2713a5`
  - Wraps Sepolia Pyth oracle: `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21`
  - Price Feed: ETH/USD (`0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`)
  - Current Price: **$2,815.94** per ETH
  - Max Staleness: 60 seconds
  - Etherscan: https://sepolia.etherscan.io/address/0xB0d9Fe62FEc791bc8e4428bCE47605fF3b2713a5

### Core Aqua Infrastructure
- **Aqua**: `0x1A2694C890e372b587e8e755eC14E650545aFEca`
  - Liquidity management protocol
  - Etherscan: https://sepolia.etherscan.io/address/0x1A2694C890e372b587e8e755eC14E650545aFEca

- **AquaAMM**: `0xb513E2cE2EAd32f64F3f6898300c14d262521238`
  - Standard Aqua AMM builder
  - Etherscan: https://sepolia.etherscan.io/address/0xb513E2cE2EAd32f64F3f6898300c14d262521238

- **AquaSwapVMRouter**: `0x5C20B012c443A595D0bC5c5B8a93e9fD122521eB`
  - Standard router (not used for DODOSwap)
  - Etherscan: https://sepolia.etherscan.io/address/0x5C20B012c443A595D0bC5c5B8a93e9fD122521eB

- **MockTaker**: `0x4651355BEDf5dE4343CD7f413832244Fa51F0C06`
  - Testing helper contract (redeployed with MyCustomOpcodes router)
  - Etherscan: https://sepolia.etherscan.io/address/0x4651355BEDf5dE4343CD7f413832244Fa51F0C06

### Custom DODOSwap Router
- **MyCustomOpcodes** (CustomSwapVMRouter): `0x3Fd87f63a331730dCbDd179eD07F923DB757a9C6`
  - Extends AquaOpcodes with custom instructions
  - **Opcode 0x1C (28)**: FixedPriceSwap instruction
  - **Opcode 0x1D (29)**: DODOSwap instruction ✨
  - Etherscan: https://sepolia.etherscan.io/address/0x3Fd87f63a331730dCbDd179eD07F923DB757a9C6

## 💰 DODOSwap Liquidity Pool

A DODOSwap pool has been created and is actively trading:

- **Pool Composition**:
  - 3 mETH (base token)
  - 8,445 mUSDC (quote token)
  
- **Price Configuration**:
  - Initial Price: **$2,815.00** per mETH
  - Matches real-world ETH/USDC pricing via Pyth oracle
  
- **DODOSwap Parameters**:
  - K Parameter: **0.1** (10% liquidity depth - tight curve)
  - Target Base Amount: 3 mETH
  - Target Quote Amount: 8,445 mUSDC
  - Base is Token In: true
  - Oracle: Real Pyth price feed on Sepolia

- **Transaction**: https://sepolia.etherscan.io/tx/0xe2b905d1419e3cea20f9f1e557485e00c4756c0ac29a4011ef400ac9e4bc6fd6

## 🔧 How to Use

### Interacting with the Pool

The DODOSwap pool uses the DODO Proactive Market Maker (PMM) algorithm with:
- Oracle-based pricing (Pyth ETH/USD)
- Dynamic R status (derived from current balances vs target balances)
- Full PMM pricing for all 6 cases (R=ONE, R<ONE, R>ONE for both directions)

### Testing Swaps

You can test swaps using the deployed contracts:

```bash
# Set environment variables
export ORACLE_ADDRESS="0xB0d9Fe62FEc791bc8e4428bCE47605fF3b2713a5"
export TOKEN0="0xC2FB82498d61e136a1d5Dd66Dc5095f4C3aCcbBD"  # mETH
export TOKEN1="0xA748Cef1c4E68Cc81448bD061A4aF8FEaD9d5558"  # mUSDC
export ROUTER="0x3Fd87f63a331730dCbDd179eD07F923DB757a9C6"  # MyCustomOpcodes
```

### Viewing on Etherscan

All contracts are verified on Etherscan. You can:
1. View contract source code
2. Read contract state
3. Write to contracts (connect wallet)
4. View transaction history

## 📝 Contract Verification Status

✅ All contracts verified on Etherscan and Sourcify:
- mETH (TokenMock0)
- mUSDC (TokenMock1)
- Oracle
- Aqua
- AquaAMM
- AquaSwapVMRouter
- MockTaker
- MyCustomOpcodes

## 🎯 Next Steps

1. **Test Swaps**: Use the test suite or integrate with a frontend to perform real swaps
2. **Monitor Oracle**: The Pyth oracle auto-updates, but you can manually update if needed
3. **Add More Liquidity**: Ship additional liquidity if needed (with different parameters to avoid StrategiesMustBeImmutable error)
4. **Integrate Frontend**: Build a UI to interact with the DODOSwap pool
5. **Analytics**: Monitor swap performance and pricing accuracy

## 📚 Documentation

- **DODOSwap README**: `DODOSWAP_README.md`
- **Migration Guide**: `MIGRATION_TO_DODOSWAP.md`
- **Architecture Deep Dive**: `docs/ARCHITECTURE_DEEP_DIVE.md`
- **Pyth Oracle Guide**: `PYTH_ORACLE_GUIDE.md`

## ⚠️ Important Notes

1. **Custom Router Required**: Always use MyCustomOpcodes (`0x3Fd87f63a331730dCbDd179eD07F923DB757a9C6`) for DODOSwap operations, not the standard AquaSwapVMRouter
2. **Opcode 0x1D**: DODOSwap instruction is registered at opcode 0x1D (29)
3. **Oracle Updates**: Pyth oracle prices update automatically, but ensure they're fresh before swaps
4. **Test Network**: This is deployed on Sepolia testnet - use test ETH only
5. **Price Ratio**: The pool maintains ~$2815/ETH ratio matching real-world prices

## 🔗 Quick Links

- **Sepolia Faucet**: https://sepoliafaucet.com/
- **Pyth Network**: https://pyth.network/
- **1inch Aqua Docs**: https://docs.1inch.io/docs/aggregation-protocol/introduction
- **SwapVM Documentation**: See `docs/swapvm-dev-preview.pdf`

## 💾 Deployment Scripts Used

1. `deploy/deploy-test-tokens.ts` - Deployed mETH and mUSDC
2. `deploy/deploy-oracle.ts` - Deployed Oracle wrapper
3. `deploy/deploy-aqua.ts` - Deployed Aqua infrastructure
4. `deploy/deploy-custom-router.ts` - Deployed MyCustomOpcodes (NEW)
5. `scripts/ship-dodoswap-liquidity.ts` - Shipped liquidity (NEW)
6. `scripts/test-dodoswap.ts` - Verification script (NEW)

## 🎊 Success Metrics

- ✅ All contracts deployed and verified
- ✅ Test tokens minted (10,000 each)
- ✅ Oracle connected to real Pyth price feed (~$2815)
- ✅ DODOSwap liquidity pool created (3 mETH / 8,445 mUSDC)
- ✅ Price ratio matches real-world ETH/USDC
- ✅ Custom router with DODOSwap opcode functional
- ✅ All transactions successful on Sepolia

---

**Deployment Date**: November 23, 2025
**Network**: Sepolia Testnet
**Deployer**: `0xabc4Cbf716472c47a61c8c2c5076895600F3cf10`


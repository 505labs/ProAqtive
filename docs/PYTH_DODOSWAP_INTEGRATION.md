# Pyth Network Integration with DODOSwap

This document explains how the DODOSwap instruction has been integrated with Pyth Network's oracle system to provide real-time, cryptographically secure price feeds.

## Overview

The DODOSwap implementation now uses Pyth Network's oracle system instead of a simple price oracle interface. This provides several benefits:

1. **Real-time Prices**: Prices are updated via Hermes API with sub-second latency
2. **Cryptographic Security**: All price updates are cryptographically signed
3. **Decentralized**: Pyth aggregates prices from 90+ first-party publishers
4. **Cross-chain**: Same price feeds available across multiple chains

## Architecture

### Flow Diagram

```
User → Hermes API → Get Signed Price Update
  ↓
User calls swap() with:
  - Regular swap parameters
  - Pyth price update data
  - ETH for update fee
  ↓
CustomSwapVMRouter (receives ETH)
  ↓
SwapVM executes program
  ↓
DODOSwap instruction:
  1. Validates parameters
  2. Calls pyth.getUpdateFee()
  3. Calls pyth.updatePriceFeeds{value: fee}()
  4. Calls pyth.getPriceNoOlderThan()
  5. Converts Pyth price to 18 decimals
  6. Executes PMM swap calculation
```

## Contract Changes

### DODOSwap.sol

**Updated Imports:**
```solidity
import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
```

**Updated DODOParams Struct:**
```solidity
struct DODOParams {
    address pythContract;          // Pyth contract address
    bytes32 priceFeedId;          // Price feed ID (e.g., ETH/USD)
    bytes[] priceUpdateData;      // Signed price data from Hermes
    uint256 maxStaleness;         // Max price age in seconds
    uint256 k;                    // PMM k parameter
    uint256 targetBaseAmount;     // Target base balance
    uint256 targetQuoteAmount;    // Target quote balance
    bool baseIsTokenIn;           // Swap direction
}
```

**Key Changes:**
- Removed `view` modifier from `_dodoSwapXD` (needed for state changes)
- Added Pyth price update logic with fee payment
- Added price format conversion (Pyth expo → 18 decimals)
- Added comprehensive error handling

### CustomSwapVMRouter.sol

**Added ETH Handling:**
```solidity
// Accept ETH for Pyth fees
receive() external payable {
    emit ETHReceived(msg.sender, msg.value);
}

// Withdraw excess ETH (governance function)
function withdrawETH(address payable recipient, uint256 amount) external {
    // Add access control in production
    (bool success, ) = recipient.call{value: amount}("");
    require(success, "ETH transfer failed");
}
```

## Usage Guide

### Step 1: Get Price Update from Hermes API

Before calling the swap function, fetch the latest price update:

```typescript
import axios from 'axios';

const HERMES_API = 'https://hermes.pyth.network';
const ETH_USD_PRICE_FEED_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

async function getPriceUpdate(priceFeedIds: string[]): Promise<string[]> {
  const response = await axios.get(`${HERMES_API}/api/latest_vaas`, {
    params: {
      ids: priceFeedIds
    }
  });
  
  return response.data.map((vaa: string) => `0x${vaa}`);
}

// Get price update
const priceUpdateData = await getPriceUpdate([ETH_USD_PRICE_FEED_ID]);
```

### Step 2: Encode DODOParams with Pyth Data

```typescript
import { ethers } from 'ethers';

const PYTH_CONTRACT = '0x...'; // Pyth contract address for your chain
const ETH_USD_FEED_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
  ["tuple(address pythContract, bytes32 priceFeedId, bytes[] priceUpdateData, uint256 maxStaleness, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"],
  [[
    PYTH_CONTRACT,
    ETH_USD_FEED_ID,
    priceUpdateData,           // From Hermes API
    60,                        // Max 60 seconds stale
    ethers.parseEther("0.1"),  // k = 0.1
    ethers.parseEther("3"),    // 3 ETH target base
    ethers.parseEther("8445"), // 8445 USDC target quote
    true                       // Base is token in
  ]]
);
```

### Step 3: Build the Swap Order

```typescript
import { ProgramBuilder, MakerTraitsLib } from './utils/helpers';

const DODO_SWAP_OPCODE = 0x1D;

// Build program
const programBuilder = new ProgramBuilder();
programBuilder.addInstruction(DODO_SWAP_OPCODE, dodoParams);
const program = programBuilder.build();

// Build order
const order = MakerTraitsLib.build({
  maker: makerAddress,
  receiver: makerAddress,
  useAquaInsteadOfSignature: true,
  program: program
});
```

### Step 4: Calculate Pyth Update Fee

```typescript
const pythContract = await ethers.getContractAt(
  "IPyth",
  PYTH_CONTRACT
);

const updateFee = await pythContract.getUpdateFee(priceUpdateData);
console.log(`Pyth update fee: ${ethers.formatEther(updateFee)} ETH`);
```

### Step 5: Execute Swap with ETH for Fee

```typescript
const router = await ethers.getContractAt(
  "CustomSwapVMRouter",
  ROUTER_ADDRESS
);

// Build taker traits
const takerTraits = TakerTraitsLib.build({
  taker: takerAddress,
  isExactIn: true,
  threshold: minAmountOut,
  useTransferFromAndAquaPush: true
});

// Send ETH for Pyth fee in separate transaction (router must have balance)
await router.connect(taker).receive({ value: updateFee });

// Or, if using a payable wrapper (future enhancement):
// const swapTx = await router.connect(taker).swap(
//   order,
//   tokenIn,
//   tokenOut,
//   amount,
//   takerTraits,
//   { value: updateFee }  // Send ETH with swap
// );

const swapTx = await router.connect(taker).swap(
  order,
  tokenIn,
  tokenOut,
  amount,
  takerTraits
);

await swapTx.wait();
```

## Price Feed IDs

Common Pyth price feed IDs:

| Pair | Price Feed ID |
|------|---------------|
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` |

Full list: https://pyth.network/developers/price-feed-ids

## Pyth Contract Addresses

| Network | Address |
|---------|---------|
| Ethereum Mainnet | `0x4305FB66699Df3f0e0f6Ef85BA64970eCCE09DD` |
| Sepolia Testnet | `0xDd24F84d36BF92C65F92307595335bdFab5Bbd21` |
| Arbitrum | `0xff1a0f4744e8582DF1aE09D5611b887B6a12925C` |

Full list: https://docs.pyth.network/price-feeds/contract-addresses/evm

## Error Handling

### DODOSwapInsufficientFeePayment
- **Cause**: Router doesn't have enough ETH to pay Pyth fee
- **Solution**: Send more ETH to router before swap, or increase value sent with transaction

### DODOSwapPriceUpdateFailed
- **Cause**: Pyth price update reverted (invalid signature, wrong chain, etc.)
- **Solution**: Fetch fresh price update from Hermes API

### DODOSwapStalePriceDetected
- **Cause**: Price is older than `maxStaleness` parameter
- **Solution**: Increase `maxStaleness` or fetch newer price update

### DODOSwapInvalidKParameter
- **Cause**: k >= 1e18 (k must be in range [0, 1))
- **Solution**: Use k < 1e18 (typically 0.1 - 0.5)

## Price Format Conversion

Pyth prices use an exponent format. The DODOSwap contract automatically converts them:

**Pyth Format:**
```
price = 3000.50 USD
Pyth returns: { price: 300050, expo: -2, conf: ... }
```

**Conversion to 18 Decimals:**
```solidity
finalPrice = price * 10^(18 + expo)
           = 300050 * 10^(18 + (-2))
           = 300050 * 10^16
           = 3000500000000000000000 (3000.5 * 10^18)
```

## Security Considerations

1. **Fee Payment**: The router contract holds ETH for fees. In production, implement access control on `withdrawETH()`

2. **Price Staleness**: Set `maxStaleness` appropriately for your use case:
   - High-frequency trading: 5-10 seconds
   - Regular swaps: 30-60 seconds
   - Low-frequency: 120+ seconds

3. **Gas Costs**: Pyth updates cost ~50k-100k gas depending on the number of price feeds

4. **Hermes Availability**: Implement fallback mechanisms if Hermes API is unavailable

5. **Price Manipulation**: Pyth's multi-publisher aggregation provides strong guarantees against manipulation

## Testing

### Local Testing

For local testing, deploy MockPyth:

```bash
npx hardhat run scripts/deploy-mock-pyth.ts --network localhost
```

### Testnet Testing

Use Sepolia testnet with real Pyth contract:

```bash
# Deploy router
npx hardhat run scripts/deploy-custom-router.ts --network sepolia

# Test swap with Pyth
npx hardhat run scripts/test-pyth-dodoswap.ts --network sepolia
```

## Gas Optimization Tips

1. **Batch Updates**: If updating multiple prices, batch them in one transaction
2. **Price Caching**: Reuse price updates within the staleness window
3. **Router Funding**: Pre-fund router with ETH to avoid per-swap deposits

## Future Enhancements

1. **Payable Swap Function**: Modify router to accept ETH directly in swap call
2. **Pull Oracle Model**: Implement on-demand price pulls within instruction
3. **Multi-Price Support**: Support multiple price feeds in single swap
4. **Conditional Updates**: Only update price if changed significantly

## Resources

- [Pyth Network Documentation](https://docs.pyth.network/)
- [Pyth Solidity SDK](https://github.com/pyth-network/pyth-crosschain/tree/main/target_chains/ethereum/sdk/solidity)
- [Hermes API Documentation](https://hermes.pyth.network/docs/)
- [Price Feed IDs](https://pyth.network/developers/price-feed-ids)
- [SwapVM Documentation](./SWAPVM.md)
- [DODO PMM Algorithm](./DODOSWAP_README.md)


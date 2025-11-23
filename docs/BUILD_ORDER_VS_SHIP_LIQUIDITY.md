# Build Order vs Ship Liquidity: Understanding the Relationship

## Quick Answer

- **`build-order.ts`**: **Off-chain computation only** - No transaction sent. Just prepares the order data structure.
- **`ship-liquidity.ts`**: **Sends an on-chain transaction** - Actually deposits tokens to Aqua with the order.

## Detailed Explanation

### 1. `build-order.ts` - Order Preparation (Off-Chain)

**What it does:**
- Calls `proAquativeAMM.buildProgram()` which is a **`pure` function**
- Computes the order data structure locally
- **No blockchain transaction is sent**
- Just prepares the fields/data needed for shipping

**The `buildProgram()` function:**
```solidity
function buildProgram(...) external pure returns (ISwapVM.Order memory) {
    // This is a PURE function - no state changes, no transactions
    // It just computes and returns data
}
```

**What it returns:**
```typescript
{
    maker: "0x...",           // Maker's address
    traits: BigInt("..."),    // Configuration flags
    data: "0x1E..."           // Bytecode program
}
```

**Key Points:**
- ✅ **Free** - No gas costs
- ✅ **Fast** - Instant computation
- ✅ **No state changes** - Doesn't modify blockchain
- ✅ **Can be called many times** - Safe to run repeatedly
- ✅ **Returns the same result** for the same inputs (pure function)

### 2. `ship-liquidity.ts` - Actual On-Chain Transaction

**What it does:**
- Optionally builds an order (or loads from file)
- **Sends a transaction** to `aqua.ship()`
- **Deposits tokens** into Aqua
- **Associates tokens with the order**

**The `aqua.ship()` function:**
```solidity
function ship(
    address app,              // SwapVM router address
    bytes calldata strategy,  // The encoded order
    address[] calldata tokens,// Token addresses
    uint256[] calldata amounts // Amounts to deposit
) external returns(bytes32 strategyHash) {
    // This MODIFIES blockchain state
    // Transfers tokens from maker to Aqua
    // Stores the order hash
}
```

**What happens:**
1. ✅ **Transaction is sent** to the blockchain
2. ✅ **Gas is consumed** (you pay for this)
3. ✅ **Tokens are transferred** from your wallet to Aqua
4. ✅ **Order is stored** in Aqua's state
5. ✅ **Order becomes active** - can now be used for swaps

**Key Points:**
- ⚠️ **Costs gas** - Requires ETH/tokens for gas fees
- ⚠️ **Modifies state** - Changes blockchain state
- ⚠️ **Can only be done once** - Same order hash cannot be shipped twice
- ⚠️ **Requires approvals** - Must approve tokens first
- ⚠️ **Requires balance** - Must have tokens to deposit

## The Relationship

```
┌─────────────────┐
│ build-order.ts  │  ← Step 1: Prepare order (off-chain, free)
│                 │     - Computes order structure
│  (pure function)│     - No transaction
└────────┬────────┘
         │
         │ Returns: { maker, traits, data }
         │
         ▼
┌─────────────────┐
│ ship-liquidity  │  ← Step 2: Ship to blockchain (on-chain, costs gas)
│      .ts        │     - Sends transaction
│                 │     - Deposits tokens
│ (state change)  │     - Stores order in Aqua
└─────────────────┘
```

## Workflow Example

### Option A: Separate Steps (Recommended)

```bash
# Step 1: Build order (off-chain, free)
npx hardhat run scripts/build-order.ts --network sepolia > order.json

# Step 2: Ship liquidity (on-chain, costs gas)
ORDER_FILE=order.json TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 \
  npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

### Option B: Combined (ship-liquidity builds order automatically)

```bash
# ship-liquidity.ts can build the order internally
TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 \
  npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

## Why Two Scripts?

1. **Separation of Concerns**
   - `build-order.ts`: Pure data preparation
   - `ship-liquidity.ts`: State-changing operation

2. **Reusability**
   - Build order once, use it multiple times
   - Share order between different operations (ship, quote, swap)

3. **Testing**
   - Test order building without spending gas
   - Verify order structure before shipping

4. **Flexibility**
   - Can build order with different parameters
   - Can ship same order multiple times (with different parameters)

## Important Notes

### `buildProgram()` is Pure
- Marked as `external pure` in Solidity
- No blockchain read/write
- Deterministic output (same inputs = same output)
- Can be called via `call()` or `staticCall()` (no transaction needed)

### `aqua.ship()` is State-Changing
- Modifies Aqua contract storage
- Transfers tokens (requires `transferFrom`)
- Emits events
- Must be called via transaction (costs gas)

### Order Uniqueness
- Each order has a unique hash (computed from order data)
- Aqua enforces: **One order hash = One shipment**
- Cannot ship same order twice (error: `StrategiesMustBeImmutable`)
- To ship again, must change order parameters (K, PRICE_ID, maker, etc.)

## Summary Table

| Aspect | `build-order.ts` | `ship-liquidity.ts` |
|--------|------------------|---------------------|
| **Transaction?** | ❌ No | ✅ Yes |
| **Gas Cost?** | ❌ Free | ✅ Costs gas |
| **State Change?** | ❌ No | ✅ Yes |
| **Token Transfer?** | ❌ No | ✅ Yes |
| **Can Repeat?** | ✅ Yes (unlimited) | ⚠️ Once per order |
| **Function Type** | `pure` | State-changing |
| **Purpose** | Prepare data | Execute on-chain |

## Analogy

Think of it like **ordering food**:

- **`build-order.ts`** = Writing your order on paper (preparing the order)
  - Free, can do it anytime
  - Just prepares the information
  
- **`ship-liquidity.ts`** = Actually placing the order and paying (sending transaction)
  - Costs money (gas)
  - Actually does something (deposits tokens)
  - Can't place the exact same order twice


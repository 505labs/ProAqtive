# AMM Implementation Guide

## Summary

I've created a simple constant product AMM example and explained how the current demo works. Here's what you need to know:

## What I Created

1. **`SimpleConstantProductAMM.sol`** - A minimal AMM using only the constant product formula
2. **`SimpleConstantProductAMM.test.ts`** - Test file demonstrating usage
3. **`docs/AMM_EXPLANATION.md`** - Detailed explanation of how everything works

## Understanding the Current Demo (AquaAMM)

The `AquaAMM` contract builds a **program** (bytecode) that SwapVM executes. Here's what happens:

### Program Flow

```
1. Deadline Check (optional) → Ensures order hasn't expired
2. Liquidity Concentration (optional) → Modifies price curve with delta0/delta1
3. Time Decay (optional) → Price changes over time
4. Trading Fee (optional) → Takes fee from input
5. SWAP (required) → Executes constant product: x * y = k
6. Protocol Fee (optional) → Takes fee from output
7. Salt (optional) → Adds uniqueness
```

### Key Instruction: `_xycSwapXD`

This is the core swap instruction that implements the **constant product formula**:
- Formula: `reserve0 * reserve1 = constant`
- When swapping: `(reserve0 + amountIn) * (reserve1 - amountOut) = constant`

## The Simple Example

`SimpleConstantProductAMM` uses **only** the swap instruction:

```solidity
function buildProgram(address maker) external pure returns (ISwapVM.Order memory) {
    Program memory program = ProgramBuilder.init(_opcodes());
    bytes memory bytecode = program.build(_xycSwapXD);  // Just the swap!
    return MakerTraitsLib.build(...);
}
```

This gives you:
- ✅ Pure constant product AMM (x * y = k)
- ❌ No fees
- ❌ No additional features

## How to Use It

### 1. Deploy the Contract

```typescript
const SimpleConstantProductAMM = await ethers.getContractFactory("SimpleConstantProductAMM");
const simpleAMM = await SimpleConstantProductAMM.deploy(aquaAddress);
```

### 2. Build an Order

```typescript
const order = await simpleAMM.buildProgram(makerAddress);
```

### 3. Ship Liquidity

```typescript
await aqua.connect(maker).ship(
    swapVMAddress,
    encodedOrder,
    [token0Address, token1Address],
    [amount0, amount1]  // Initial reserves
);
```

### 4. Execute Swap

```typescript
const takerData = TakerTraitsLib.build({
    taker: takerAddress,
    isExactIn: true,
    threshold: minOutput,
    useTransferFromAndAquaPush: true
});

await swapVM.connect(taker).swap(
    order,
    tokenIn,
    tokenOut,
    amountIn,
    takerData
);
```

## Implementing Different Price Curves

### Option 1: Use Built-in Instructions

SwapVM provides several swap mechanisms:
- `XYC_SWAP_XD` - Constant product (current)
- `DECAY_XD` - Time-based decay
- `LIMIT_SWAP_1D` - Limit orders
- `DUTCH_AUCTION_BALANCE_IN_1D` - Dutch auctions
- `TWAP` - Time-weighted average price

You can combine these with modifiers like:
- `XYC_CONCENTRATE_GROW_LIQUIDITY_2D` - Concentrates liquidity
- `FLAT_FEE_AMOUNT_IN_XD` - Adds fees
- `BASE_FEE_ADJUSTER_1D` - Gas-based price adjustment

### Option 2: Custom Instructions

For truly custom price curves (e.g., linear, logarithmic), you need to:
1. Extend SwapVM with a new instruction
2. Implement your price calculation logic
3. Add the opcode to the instruction set

This requires modifying the SwapVM core contracts.

## Files Created

- `contracts/SimpleConstantProductAMM.sol` - The simple AMM contract
- `test/SimpleConstantProductAMM.test.ts` - Test file
- `docs/AMM_EXPLANATION.md` - Detailed technical explanation
- `IMPLEMENTATION_GUIDE.md` - This file

## Next Steps

1. **Run the tests**: `npx hardhat test test/SimpleConstantProductAMM.test.ts`
2. **Read the detailed explanation**: `docs/AMM_EXPLANATION.md`
3. **Experiment**: Modify `SimpleConstantProductAMM` to add features
4. **Build your own**: Use it as a template for your custom AMM

## Key Concepts

- **Programs, not contracts**: SwapVM executes bytecode programs
- **Instructions are composable**: Combine multiple instructions
- **XYC = Constant Product**: The base swap uses x * y = k formula
- **Start simple**: Build complexity incrementally


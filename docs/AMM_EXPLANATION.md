# Understanding AMM Implementation with SwapVM

## Overview

This document explains how the current `AquaAMM` demo works and how to implement different price curves using 1inch's SwapVM.

## How SwapVM Works

SwapVM is a virtual machine that executes swap programs. Instead of writing a full AMM contract, you build a **program** (bytecode) that tells SwapVM how to execute swaps. The program consists of a sequence of **instructions** (opcodes) that SwapVM executes.

### Key Components

1. **Program Builder**: Constructs the bytecode program from instructions
2. **Instructions**: Individual operations (swap, fees, controls, etc.)
3. **Maker Traits**: Configuration for the order (maker address, hooks, etc.)
4. **Taker Traits**: Configuration for the swap execution (taker address, exact in/out, etc.)

## Current Demo: AquaAMM Explained

The `AquaAMM` contract demonstrates a **concentrated liquidity AMM** with optional features. Let's break down what each part does:

### The `buildProgram` Function

```solidity
function buildProgram(
    address maker,
    address token0,
    address token1,
    uint16 feeBpsIn,
    uint256 delta0,
    uint256 delta1,
    uint16 decayPeriod,
    uint16 protocolFeeBpsIn,
    address feeReceiver,
    uint64 salt,
    uint32 deadline
) external pure returns (ISwapVM.Order memory)
```

### Program Construction

The program is built by concatenating instructions:

```solidity
bytes memory bytecode = bytes.concat(
    // 1. Deadline check (optional)
    (deadline > 0) ? program.build(_deadline, ControlsArgsBuilder.buildDeadline(deadline)) : bytes(""),
    
    // 2. Liquidity concentration (optional)
    (delta0 != 0 || delta1 != 0) ? program.build(_xycConcentrateGrowLiquidity2D, ...) : bytes(""),
    
    // 3. Time-based price decay (optional)
    (decayPeriod > 0) ? program.build(_decayXD, DecayArgsBuilder.build(decayPeriod)) : bytes(""),
    
    // 4. Trading fee (optional)
    (feeBpsIn > 0) ? program.build(_flatFeeAmountInXD, FeeArgsBuilder.buildFlatFee(feeBpsIn)) : bytes(""),
    
    // 5. Protocol fee (optional)
    (protocolFeeBpsIn > 0) ? program.build(_aquaProtocolFeeAmountOutXD, ...) : bytes(""),
    
    // 6. THE ACTUAL SWAP - This is the core instruction
    program.build(_xycSwapXD),
    
    // 7. Salt for order uniqueness (optional)
    (salt > 0) ? program.build(_salt, ControlsArgsBuilder.buildSalt(salt)) : bytes("")
);
```

### Instruction Breakdown

1. **`_deadline`**: Ensures the order expires after a certain timestamp
2. **`_xycConcentrateGrowLiquidity2D`**: Modifies the price curve by concentrating liquidity around a specific price range (delta0, delta1 parameters)
3. **`_decayXD`**: Implements time-based price decay - the price changes over time
4. **`_flatFeeAmountInXD`**: Takes a fee from the input amount (basis points)
5. **`_aquaProtocolFeeAmountOutXD`**: Takes a protocol fee from the output amount
6. **`_xycSwapXD`**: **The core swap instruction** - implements constant product formula (x * y = k)
7. **`_salt`**: Adds uniqueness to orders

### The Core: XYC Swap

**XYC_SWAP_XD** implements the constant product formula:
```
reserve0 * reserve1 = constant (k)
```

When swapping:
- Input: `amountIn` of `tokenIn`
- Output: `amountOut` of `tokenOut`
- Formula: `(reserve0 + amountIn) * (reserve1 - amountOut) = k`

### How It Works in Practice

1. **Maker** calls `buildProgram()` to create an order
2. **Maker** ships liquidity to Aqua using `aqua.ship()` with the order
3. **Taker** calls `swapVM.swap()` with the order
4. SwapVM executes the program:
   - Checks deadline (if set)
   - Applies liquidity concentration (if set)
   - Applies decay (if set)
   - Takes fees (if set)
   - Executes the swap using constant product formula
   - Takes protocol fee (if set)
5. Tokens are transferred between maker and taker

## Simple Constant Product AMM

The `SimpleConstantProductAMM` demonstrates the **minimal** implementation:

```solidity
function buildProgram(address maker) external pure returns (ISwapVM.Order memory) {
    Program memory program = ProgramBuilder.init(_opcodes());
    
    // Only the swap instruction - nothing else!
    bytes memory bytecode = program.build(_xycSwapXD);
    
    return MakerTraitsLib.build(MakerTraitsLib.Args({...}));
}
```

This is the simplest possible AMM:
- ✅ Constant product formula (x * y = k)
- ❌ No fees
- ❌ No liquidity concentration
- ❌ No time-based decay
- ❌ No deadlines

## Implementing Different Price Curves

### Available Swap Instructions

SwapVM provides several built-in swap mechanisms:

1. **`XYC_SWAP_XD`** (0x11): Constant product (x * y = k) - **Uniswap-style**
2. **`DECAY_XD`** (0x14): Time-based price decay
3. **`LIMIT_SWAP_1D`** (0x1A): Limit orders
4. **`DUTCH_AUCTION_BALANCE_IN_1D`** (0x1E): Dutch auction
5. **`TWAP`** (0x22): TWAP (Time-Weighted Average Price) trading

### Custom Price Curves

To implement a **completely custom** price curve, you have a few options:

#### Option 1: Use Built-in Instructions in Combination

You can combine multiple instructions to create complex curves:

```solidity
// Example: Constant product with liquidity concentration
bytes memory bytecode = bytes.concat(
    program.build(_xycConcentrateGrowLiquidity2D, ...),  // Modifies the curve
    program.build(_xycSwapXD)                             // Base swap
);
```

#### Option 2: Use Balance Instructions for Custom Logic

You can use `STATIC_BALANCES_XD` or `DYNAMIC_BALANCES_XD` to read balances and implement custom calculations, but you'd need to use conditional jumps and manual calculations.

#### Option 3: Create a Custom Instruction

For truly custom price curves (e.g., linear, logarithmic, etc.), you would need to:
1. Create a new instruction in the SwapVM codebase
2. Implement the price calculation logic
3. Add the opcode to the instruction set

This requires modifying the SwapVM core contracts.

### Example: Linear Price Curve (Conceptual)

If you wanted a linear price curve (price = m * amount + b), you would need to:

1. Create a new instruction `LINEAR_SWAP_XD`
2. Implement the calculation: `amountOut = (amountIn * priceSlope) + priceIntercept`
3. Add it to the opcodes
4. Use it in your program:

```solidity
bytes memory bytecode = program.build(_linearSwapXD, LinearArgsBuilder.build(priceSlope, priceIntercept));
```

## Comparison: AquaAMM vs SimpleConstantProductAMM

| Feature | AquaAMM | SimpleConstantProductAMM |
|---------|---------|-------------------------|
| Base Formula | Constant Product (x * y = k) | Constant Product (x * y = k) |
| Fees | ✅ Configurable | ❌ None |
| Liquidity Concentration | ✅ Yes (delta0, delta1) | ❌ No |
| Time Decay | ✅ Yes (decayPeriod) | ❌ No |
| Protocol Fees | ✅ Yes | ❌ No |
| Deadlines | ✅ Yes | ❌ No |
| Complexity | High | Minimal |

## Usage Examples

### Using AquaAMM (Full Featured)

```typescript
const order = await aquaAMM.buildProgram(
    makerAddress,
    token0Address,
    token1Address,
    30,        // 0.3% fee (30 bps)
    100,       // delta0 concentration
    100,       // delta1 concentration
    86400,     // 1 day decay period
    10,        // 0.1% protocol fee (10 bps)
    feeReceiverAddress,
    12345,     // salt
    0          // no deadline
);
```

### Using SimpleConstantProductAMM

```typescript
const order = await simpleAMM.buildProgram(
    makerAddress  // That's it!
);
```

## Key Takeaways

1. **SwapVM uses programs**: You build bytecode, not write full contracts
2. **XYC_SWAP_XD is constant product**: The base swap instruction implements x * y = k
3. **Instructions are composable**: Combine multiple instructions for complex behavior
4. **Custom curves require new instructions**: For truly custom formulas, you need to extend SwapVM
5. **Start simple**: Use `SimpleConstantProductAMM` as a base and add features as needed

## Next Steps

To implement your own price curve:

1. **Start with SimpleConstantProductAMM** - understand the basics
2. **Experiment with instruction combinations** - see what's possible with built-ins
3. **Check SwapVM documentation** - see all available instructions
4. **For custom curves** - consider if you can achieve it with existing instructions first
5. **If truly custom needed** - plan to extend SwapVM with new instructions


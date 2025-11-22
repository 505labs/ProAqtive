# Complete Guide: Understanding SwapVM Architecture

## Quick Summary

I've created a comprehensive explanation of how SwapVM works and where you can insert your own code. Here's what you need to know:

## The Complete Flow

### 1. **ProgramBuilder** - Converts Functions to Bytecode
- **What**: A library that takes instruction function pointers and converts them to bytecode
- **How**: Finds the function's index in the opcodes array, returns `[opcode][length][args]`
- **Where**: `@1inch/swap-vm/test/utils/ProgramBuilder.sol`

### 2. **AquaOpcodes** - The Instruction Registry
- **What**: A contract that defines which instructions exist and their opcode numbers
- **How**: Returns an array of instruction functions - the array index becomes the opcode
- **Where**: `@1inch/swap-vm/src/opcodes/AquaOpcodes.sol`
- **Key**: `_xycSwapXD` is at index 17, so it's opcode `0x11`

### 3. **Instructions** - The Actual Logic
- **What**: Contracts/libraries that implement swap calculations
- **Signature**: `function _instructionName(Context memory ctx, bytes calldata args) internal pure/view`
- **How**: Read from `ctx.swap.balanceIn/balanceOut`, write to `ctx.swap.amountIn/amountOut`
- **Where**: `@1inch/swap-vm/src/instructions/*.sol`

### 4. **Context** - The Execution State
- **What**: A struct holding all swap state during execution
- **Contains**: 
  - `ctx.query` (read-only): maker, taker, tokens, isExactIn
  - `ctx.swap` (read-write): balances, amounts
- **Where**: `@1inch/swap-vm/src/libs/VM.sol`

### 5. **SwapVM** - The Executor
- **What**: Executes the bytecode program instruction by instruction
- **How**: Reads bytecode, looks up instruction functions, calls them with Context
- **Where**: `@1inch/swap-vm/src/SwapVM.sol`

## Where to Write Your Own Code

### Option 1: Use Existing Instructions (Easiest) ✅

**Location**: Your contract's `buildProgram()` function

**What you do**: Combine existing instructions in different orders

```solidity
contract MyAMM is AquaOpcodes {
    function buildProgram(...) external pure returns (ISwapVM.Order memory) {
        Program memory program = ProgramBuilder.init(_opcodes());
        
        bytes memory bytecode = bytes.concat(
            program.build(_flatFeeAmountInXD, FeeArgsBuilder.buildFlatFee(30)),
            program.build(_xycSwapXD),
            program.build(_aquaProtocolFeeAmountOutXD, ...)
        );
        
        return MakerTraitsLib.build(...);
    }
}
```

**Limitation**: Can only use instructions that exist in `AquaOpcodes`

### Option 2: Create Custom Instructions (Advanced) 🚀

**Location**: Create new contracts in your project

**Steps**:

1. **Create instruction contract** (`contracts/instructions/MySwap.sol`):
```solidity
contract MySwap {
    function _mySwapXD(Context memory ctx, bytes calldata args) internal pure {
        // Your custom logic here
        // Read: ctx.swap.balanceIn, ctx.swap.balanceOut
        // Write: ctx.swap.amountIn, ctx.swap.amountOut
    }
}
```

2. **Extend AquaOpcodes** (`contracts/MyCustomOpcodes.sol`):
```solidity
contract MyCustomOpcodes is AquaOpcodes, MySwap {
    function _opcodes() internal pure override returns (...) {
        // Get parent opcodes
        function(...) internal[] memory parent = super._opcodes();
        
        // Create new array with your instruction added
        function(...) internal[] memory instructions = new function(...) internal[](parent.length + 1);
        
        // Copy parent
        for (uint i = 0; i < parent.length; i++) {
            instructions[i] = parent[i];
        }
        
        // Add yours at the end
        instructions[parent.length] = MySwap._mySwapXD;
        
        return instructions;
    }
}
```

3. **Use in your AMM** (`contracts/MyAMM.sol`):
```solidity
contract MyAMM is MyCustomOpcodes {
    function buildProgram(...) external pure returns (ISwapVM.Order memory) {
        Program memory program = ProgramBuilder.init(_opcodes());
        bytes memory bytecode = program.build(_mySwapXD);
        return MakerTraitsLib.build(...);
    }
}
```

## Example Files Created

I've created a complete working example:

1. **`contracts/instructions/FixedPriceSwap.sol`** - Custom instruction (1:1 swap)
2. **`contracts/MyCustomOpcodes.sol`** - Extends AquaOpcodes to include it
3. **`contracts/FixedPriceAMM.sol`** - AMM using the custom instruction

These files compile successfully and demonstrate the full flow!

## Understanding the Code Flow

### When you call `buildProgram()`:

```
1. ProgramBuilder.init(_opcodes())
   ↓
   Creates Program struct with array of instruction functions

2. program.build(_xycSwapXD)
   ↓
   Finds _xycSwapXD in the opcodes array (index 17)
   ↓
   Returns bytecode: [0x11][0x00] (opcode 17, no args)

3. MakerTraitsLib.build(...)
   ↓
   Wraps bytecode in an Order struct
```

### When SwapVM executes:

```
1. SwapVM reads bytecode: [0x11][0x00]
   ↓
2. Extracts opcode: 0x11 (17 decimal)
   ↓
3. Looks up ctx.vm.opcodes[17] → finds _xycSwapXD function
   ↓
4. Calls _xycSwapXD(ctx, args)
   ↓
5. _xycSwapXD calculates and sets ctx.swap.amountOut
   ↓
6. SwapVM transfers tokens based on ctx.swap.amountIn/amountOut
```

## Key Concepts

1. **Opcodes are just array indices**: The position in `_opcodes()` array = opcode number
2. **Instructions modify Context**: They read balances, calculate amounts, write to `ctx.swap`
3. **ProgramBuilder is a compiler**: Converts function references to bytecode
4. **SwapVM is an interpreter**: Executes bytecode by calling functions

## Documentation Files

- **`docs/ARCHITECTURE_DEEP_DIVE.md`** - Complete technical explanation
- **`docs/AMM_EXPLANATION.md`** - How AMMs work with SwapVM
- **`IMPLEMENTATION_GUIDE.md`** - Quick reference

## Next Steps

1. **Read** `docs/ARCHITECTURE_DEEP_DIVE.md` for full details
2. **Study** the example files (`FixedPriceSwap.sol`, `MyCustomOpcodes.sol`, `FixedPriceAMM.sol`)
3. **Experiment** with combining existing instructions
4. **Create** your own instruction when you need custom logic

## Common Questions

**Q: Why do I need `_opcodes()`?**
A: ProgramBuilder needs to know which instruction functions exist and their order to assign opcode numbers.

**Q: Can I modify existing instructions?**
A: Not easily - you'd need to fork SwapVM. Better to create a new instruction.

**Q: How do I pass parameters to my instruction?**
A: Encode them in the `args` parameter when calling `program.build()`, then decode in your instruction.

**Q: What can my instruction do?**
A: Read from `ctx.query` and `ctx.swap.balanceIn/Out`, write to `ctx.swap.amountIn/Out`. Must be `pure` or `view`.

**Q: How do I test my custom instruction?**
A: Create a test similar to `test/SimpleConstantProductAMM.test.ts`, but use your custom AMM contract.

## Summary

- **ProgramBuilder**: Function pointers → Bytecode
- **AquaOpcodes**: Defines available instructions
- **Instructions**: Implement swap logic
- **Context**: Execution state
- **SwapVM**: Executes bytecode

To add custom code:
1. Use existing instructions (easy)
2. Create new instruction + extend AquaOpcodes (advanced)

The example files show exactly how to do option 2!


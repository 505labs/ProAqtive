# SwapVM Architecture Deep Dive

## Complete Flow Explanation

This document explains the entire SwapVM architecture, how components fit together, and where you can insert your own custom code.

## The Big Picture

SwapVM is a **virtual machine** that executes **programs** (bytecode) to perform swaps. Think of it like this:

1. **You write a program** (sequence of instructions) as bytecode
2. **SwapVM executes the program** instruction by instruction
3. **Each instruction** can read/modify the swap state (balances, amounts, etc.)

## Component Breakdown

### 1. ProgramBuilder - The Bytecode Generator

**Location**: `@1inch/swap-vm/test/utils/ProgramBuilder.sol`

**What it does**: Converts instruction function pointers into bytecode.

```solidity
struct Program {
    function(Context memory, bytes calldata) internal[] opcodes;
}

library ProgramBuilder {
    function init(function(Context memory, bytes calldata) internal[] memory opcodes) 
        internal pure returns (Program memory)
    
    function build(Program memory self, function(Context memory, bytes calldata) internal instruction) 
        internal pure returns (bytes memory)
    
    function build(Program memory self, function(Context memory, bytes calldata) internal instruction, bytes memory args) 
        internal pure returns (bytes memory)
}
```

**How it works**:
1. Takes an array of instruction functions (the opcode table)
2. When you call `build()`, it finds the index of your instruction function in that array
3. Returns bytecode: `[opcode_index (1 byte)][args_length (1 byte)][args (variable)]`

**Example**:
```solidity
// If _xycSwapXD is at index 17 in the opcodes array
program.build(_xycSwapXD) 
// Returns: 0x1100 (opcode=0x11, length=0x00, no args)
```

### 2. AquaOpcodes - The Instruction Registry

**Location**: `@1inch/swap-vm/src/opcodes/AquaOpcodes.sol`

**What it does**: Defines which instructions are available and their order (opcode numbers).

```solidity
contract AquaOpcodes is Controls, XYCSwap, XYCConcentrate, Decay, Fee {
    function _opcodes() internal pure virtual returns (
        function(Context memory, bytes calldata) internal[] memory result
    ) {
        function(Context memory, bytes calldata) internal[29] memory instructions = [
            _notInstruction,           // 0x00
            _notInstruction,           // 0x01
            // ... more reserved slots
            Controls._jump,           // 0x0A
            Controls._jumpIfTokenIn,   // 0x0B
            // ...
            XYCSwap._xycSwapXD,       // 0x11 ← This is the constant product swap!
            // ...
        ];
        return instructions;
    }
}
```

**Key Points**:
- The **array index** becomes the **opcode number**
- `_xycSwapXD` at index 17 = opcode `0x11`
- Your contract inherits from `AquaOpcodes` to get access to `_opcodes()`

### 3. Instructions - The Actual Logic

**Location**: `@1inch/swap-vm/src/instructions/*.sol`

**What they are**: Contracts/libraries that implement swap logic.

**Signature**: All instructions must have this signature:
```solidity
function _instructionName(Context memory ctx, bytes calldata args) internal pure/view
```

**Example - XYCSwap**:
```solidity
contract XYCSwap {
    function _xycSwapXD(Context memory ctx, bytes calldata /* args */) internal pure {
        // Reads from ctx.swap.balanceIn, ctx.swap.balanceOut
        // Writes to ctx.swap.amountIn or ctx.swap.amountOut
        
        if (ctx.query.isExactIn) {
            // Calculate amountOut using constant product formula
            ctx.swap.amountOut = (ctx.swap.amountIn * ctx.swap.balanceOut) / 
                                 (ctx.swap.balanceIn + ctx.swap.amountIn);
        } else {
            // Calculate amountIn
            ctx.swap.amountIn = Math.ceilDiv(
                ctx.swap.amountOut * ctx.swap.balanceIn,
                ctx.swap.balanceOut - ctx.swap.amountOut
            );
        }
    }
}
```

### 4. Context - The Execution State

**Location**: `@1inch/swap-vm/src/libs/VM.sol`

**What it is**: A struct that holds all swap state during execution.

```solidity
struct Context {
    VM vm;              // VM state (program counter, opcodes array, etc.)
    SwapQuery query;    // Read-only: maker, taker, tokens, isExactIn
    SwapRegisters swap; // Read-write: balances, amounts
}

struct SwapRegisters {
    uint256 balanceIn;   // Current balance of tokenIn
    uint256 balanceOut;  // Current balance of tokenOut
    uint256 amountIn;    // Amount being swapped in (computed by instructions)
    uint256 amountOut;   // Amount being swapped out (computed by instructions)
}
```

**How it works**:
- SwapVM initializes `Context` with balances from Aqua
- Instructions read/modify `ctx.swap.amountIn` and `ctx.swap.amountOut`
- After program execution, SwapVM uses these amounts to transfer tokens

### 5. SwapVM - The Executor

**Location**: `@1inch/swap-vm/src/SwapVM.sol`

**What it does**: Executes the bytecode program.

**Execution Flow** (simplified):
```solidity
function swap(...) external {
    // 1. Initialize Context with balances from Aqua
    Context memory ctx = initializeContext(...);
    
    // 2. Execute program bytecode
    runLoop(ctx);
    
    // 3. Transfer tokens based on ctx.swap.amountIn/amountOut
    transferTokens(...);
}

function runLoop(Context memory ctx) internal {
    bytes calldata program = ctx.program();
    
    for (uint256 pc = 0; pc < program.length; ) {
        uint8 opcode = uint8(program[pc++]);
        uint8 argsLength = uint8(program[pc++]);
        bytes calldata args = program[pc:pc+argsLength];
        pc += argsLength;
        
        // Call the instruction function at opcode index
        ctx.vm.opcodes[opcode](ctx, args);
    }
}
```

## Complete Flow: From Your Contract to Execution

### Step 1: Your Contract Builds the Program

```solidity
contract SimpleConstantProductAMM is AquaOpcodes {
    function buildProgram(address maker) external pure returns (ISwapVM.Order memory) {
        // 1. Get the opcodes array (instruction registry)
        Program memory program = ProgramBuilder.init(_opcodes());
        //    ↑ This gives you access to all instruction functions
        
        // 2. Build bytecode by referencing instruction functions
        bytes memory bytecode = program.build(_xycSwapXD);
        //    ↑ Finds _xycSwapXD in the opcodes array
        //    ↑ Returns: [0x11][0x00] (opcode 17, no args)
        
        // 3. Wrap in an Order with MakerTraits
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            program: bytecode,  // ← This bytecode will be executed
            // ... other traits
        }));
    }
}
```

### Step 2: Maker Ships Liquidity

```solidity
// Maker calls aqua.ship() with the order
await aqua.ship(
    swapVMAddress,
    encodedOrder,  // Contains the bytecode program
    [token0, token1],
    [amount0, amount1]  // Initial reserves
);
```

### Step 3: Taker Calls Swap

```solidity
// Taker calls swapVM.swap()
await swapVM.swap(
    order,      // Contains the bytecode program
    tokenIn,
    tokenOut,
    amountIn,
    takerData
);
```

### Step 4: SwapVM Executes the Program

```
1. SwapVM reads the bytecode: [0x11][0x00]
2. Extracts opcode: 0x11 (17 in decimal)
3. Looks up ctx.vm.opcodes[17] → finds _xycSwapXD function
4. Calls _xycSwapXD(ctx, args)
5. _xycSwapXD reads balances, calculates amountOut, writes to ctx.swap.amountOut
6. SwapVM transfers tokens based on ctx.swap.amountIn/amountOut
```

## Where to Write Your Own Code

### Option 1: Use Existing Instructions (Easiest)

**Where**: In your contract's `buildProgram()` function

**What you do**: Combine existing instructions in different orders.

```solidity
function buildProgram(...) external pure returns (ISwapVM.Order memory) {
    Program memory program = ProgramBuilder.init(_opcodes());
    
    bytes memory bytecode = bytes.concat(
        // Add a fee first
        program.build(_flatFeeAmountInXD, FeeArgsBuilder.buildFlatFee(30)), // 0.3%
        
        // Then do the swap
        program.build(_xycSwapXD),
        
        // Then add protocol fee
        program.build(_aquaProtocolFeeAmountOutXD, FeeArgsBuilder.buildProtocolFee(10, feeReceiver))
    );
    
    return MakerTraitsLib.build(...);
}
```

**Limitation**: You can only use instructions that already exist in `AquaOpcodes`.

### Option 2: Create a Custom Instruction (Advanced)

**Where**: Create a new contract/library in your project

**Steps**:

1. **Create your instruction contract**:
```solidity
// contracts/instructions/LinearSwap.sol
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

contract LinearSwap {
    using ContextLib for Context;
    
    // Linear price: amountOut = amountIn * priceSlope + priceIntercept
    function _linearSwapXD(Context memory ctx, bytes calldata args) internal pure {
        // Decode args: [priceSlope (32 bytes)][priceIntercept (32 bytes)]
        uint256 priceSlope = uint256(bytes32(args[0:32]));
        uint256 priceIntercept = uint256(bytes32(args[32:64]));
        
        if (ctx.query.isExactIn) {
            // Linear formula: out = in * slope + intercept
            ctx.swap.amountOut = (ctx.swap.amountIn * priceSlope) / 1e18 + priceIntercept;
        } else {
            // Reverse: in = (out - intercept) / slope
            ctx.swap.amountIn = ((ctx.swap.amountOut - priceIntercept) * 1e18) / priceSlope;
        }
    }
}
```

2. **Create an ArgsBuilder** (optional, for convenience):
```solidity
// contracts/instructions/LinearSwapArgsBuilder.sol
library LinearSwapArgsBuilder {
    function build(uint256 priceSlope, uint256 priceIntercept) 
        internal pure returns (bytes memory) 
    {
        return abi.encodePacked(priceSlope, priceIntercept);
    }
}
```

3. **Extend AquaOpcodes to include your instruction**:
```solidity
// contracts/MyCustomOpcodes.sol
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { LinearSwap } from "./instructions/LinearSwap.sol";

contract MyCustomOpcodes is AquaOpcodes, LinearSwap {
    constructor(address aqua) AquaOpcodes(aqua) {}
    
    // Override _opcodes() to add your instruction
    function _opcodes() internal pure override returns (
        function(Context memory, bytes calldata) internal[] memory result
    ) {
        // Get parent opcodes
        function(Context memory, bytes calldata) internal[] memory parent = super._opcodes();
        
        // Create new array with one more slot
        function(Context memory, bytes calldata) internal[] memory instructions = new function(Context memory, bytes calldata) internal[](parent.length + 1);
        
        // Copy parent opcodes
        for (uint i = 0; i < parent.length; i++) {
            instructions[i] = parent[i];
        }
        
        // Add your instruction at the end
        instructions[parent.length] = LinearSwap._linearSwapXD;
        
        return instructions;
    }
}
```

4. **Use it in your AMM contract**:
```solidity
contract LinearAMM is MyCustomOpcodes {
    constructor(address aqua) MyCustomOpcodes(aqua) {}
    
    function buildProgram(
        address maker,
        uint256 priceSlope,
        uint256 priceIntercept
    ) external pure returns (ISwapVM.Order memory) {
        Program memory program = ProgramBuilder.init(_opcodes());
        
        // Use your custom instruction
        bytes memory bytecode = program.build(
            _linearSwapXD,  // Your custom instruction
            LinearSwapArgsBuilder.build(priceSlope, priceIntercept)
        );
        
        return MakerTraitsLib.build(...);
    }
}
```

**Important Notes**:
- Your instruction must match the signature: `function(Context memory, bytes calldata) internal`
- You can read from `ctx.query` (read-only) and modify `ctx.swap` (read-write)
- The opcode number is determined by the array index in `_opcodes()`

### Option 3: Modify Existing Instructions (Not Recommended)

**Where**: Fork the SwapVM package

**What you do**: Modify the instruction implementations directly.

**Warning**: This requires maintaining a fork and may break compatibility.

## Understanding the Instruction Signature

Every instruction must follow this pattern:

```solidity
function _instructionName(
    Context memory ctx,      // The execution state (read/write)
    bytes calldata args      // Instruction-specific arguments
) internal pure/view
```

**Context (`ctx`)**:
- `ctx.query` - Read-only swap info (maker, taker, tokens, isExactIn)
- `ctx.swap.balanceIn/balanceOut` - Current token balances (read-only from Aqua)
- `ctx.swap.amountIn/amountOut` - **You modify these** to set swap amounts

**Args (`args`)**:
- Encoded parameters specific to your instruction
- You decode them yourself (e.g., `abi.decode(args, (uint256, address))`)

## Example: Building a Custom AMM Step-by-Step

Let's create a "Fixed Price AMM" that always swaps at 1:1 ratio:

### Step 1: Create the Instruction

```solidity
// contracts/instructions/FixedPriceSwap.sol
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

contract FixedPriceSwap {
    using ContextLib for Context;
    
    error InsufficientBalance();
    
    function _fixedPriceSwapXD(Context memory ctx, bytes calldata /* args */) internal pure {
        if (ctx.query.isExactIn) {
            // 1:1 swap - output equals input
            ctx.swap.amountOut = ctx.swap.amountIn;
            
            // Check we have enough balance
            require(ctx.swap.balanceOut >= ctx.swap.amountOut, InsufficientBalance());
        } else {
            // Reverse: input equals output
            ctx.swap.amountIn = ctx.swap.amountOut;
            
            // Check we have enough balance
            require(ctx.swap.balanceIn >= ctx.swap.amountIn, InsufficientBalance());
        }
    }
}
```

### Step 2: Extend AquaOpcodes

```solidity
// contracts/MyOpcodes.sol
pragma solidity 0.8.30;

import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { FixedPriceSwap } from "./instructions/FixedPriceSwap.sol";

contract MyOpcodes is AquaOpcodes, FixedPriceSwap {
    constructor(address aqua) AquaOpcodes(aqua) {}
    
    function _opcodes() internal pure override returns (
        function(Context memory, bytes calldata) internal[] memory
    ) {
        // Get parent opcodes (29 instructions)
        function(Context memory, bytes calldata) internal[] memory parent = super._opcodes();
        
        // Create new array with our instruction added
        function(Context memory, bytes calldata) internal[] memory instructions = 
            new function(Context memory, bytes calldata) internal[](parent.length + 1);
        
        // Copy all parent instructions
        for (uint i = 0; i < parent.length; i++) {
            instructions[i] = parent[i];
        }
        
        // Add our instruction at index 29 (0x1D)
        instructions[parent.length] = FixedPriceSwap._fixedPriceSwapXD;
        
        return instructions;
    }
}
```

### Step 3: Create Your AMM Contract

```solidity
// contracts/FixedPriceAMM.sol
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { ProgramBuilder, Program } from "@1inch/swap-vm/test/utils/ProgramBuilder.sol";
import { MyOpcodes } from "./MyOpcodes.sol";

contract FixedPriceAMM is MyOpcodes {
    using ProgramBuilder for Program;
    
    constructor(address aqua) MyOpcodes(aqua) {}
    
    function buildProgram(address maker) external pure returns (ISwapVM.Order memory) {
        Program memory program = ProgramBuilder.init(_opcodes());
        
        // Use our custom instruction (opcode 0x1D)
        bytes memory bytecode = program.build(_fixedPriceSwapXD);
        
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: bytecode
        }));
    }
}
```

## Key Takeaways

1. **ProgramBuilder** converts function pointers to bytecode
2. **AquaOpcodes** defines which instructions exist and their opcode numbers
3. **Instructions** are functions that modify `Context` to calculate swap amounts
4. **SwapVM** executes bytecode by calling instruction functions
5. **To add custom logic**: Create a new instruction contract and extend `AquaOpcodes`

## Common Patterns

### Pattern 1: Pre-processing (e.g., fees)
```solidity
bytes memory bytecode = bytes.concat(
    program.build(_flatFeeAmountInXD, FeeArgsBuilder.buildFlatFee(30)), // Take fee first
    program.build(_xycSwapXD)  // Then swap
);
```

### Pattern 2: Conditional Logic
```solidity
bytes memory bytecode = bytes.concat(
    program.build(_jumpIfTokenIn, ControlsArgsBuilder.buildJumpIfToken(tokenA, 10)), // If tokenA, skip to PC 10
    program.build(_xycSwapXD),  // Default swap
    // ... more instructions at PC 10
);
```

### Pattern 3: Post-processing (e.g., protocol fees)
```solidity
bytes memory bytecode = bytes.concat(
    program.build(_xycSwapXD),  // Swap first
    program.build(_aquaProtocolFeeAmountOutXD, ...)  // Then take protocol fee
);
```

## Debugging Tips

1. **Check opcode numbers**: Make sure your instruction is in the `_opcodes()` array
2. **Verify bytecode**: The bytecode should be `[opcode][length][args...]`
3. **Context state**: Instructions can only modify `ctx.swap.amountIn/amountOut`
4. **Args encoding**: Make sure you encode/decode args correctly

## Next Steps

1. Start with existing instructions (Option 1)
2. Experiment with different instruction combinations
3. When you need custom logic, create a new instruction (Option 2)
4. Test thoroughly - instructions execute in a VM context


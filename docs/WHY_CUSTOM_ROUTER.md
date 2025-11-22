# Why CustomSwapVMRouter is Necessary

## The Problem

When you create a custom instruction, you need **two** contracts that use the same opcodes:

1. **Program Builder** (`FixedPriceAMM`) - Creates bytecode
2. **Program Executor** (`CustomSwapVMRouter`) - Executes bytecode

## The Flow

### Step 1: Building the Program (FixedPriceAMM)

```solidity
// FixedPriceAMM.buildProgram()
Program memory program = ProgramBuilder.init(_opcodes());  // Uses MyCustomOpcodes._opcodes()
bytes memory bytecode = program.build(_fixedPriceSwapXD);  // Finds it at index 29
// Returns: [0x1D][0x00] (opcode 29, no args)
```

**MyCustomOpcodes._opcodes()** returns:
```
[0x00] _notInstruction
[0x01] _notInstruction
...
[0x11] XYCSwap._xycSwapXD
...
[0x1D] FixedPriceSwap._fixedPriceSwapXD  ← Our custom instruction at index 29
```

### Step 2: Executing the Program (CustomSwapVMRouter)

```solidity
// SwapVM.runLoop() reads the bytecode
uint8 opcode = uint8(program[pc++]);  // Reads 0x1D (29)
ctx.vm.opcodes[opcode](ctx, args);     // Calls opcodes[29]
```

**The executor needs the same opcodes array!**

## The Mismatch

### ❌ Using Standard Router (Won't Work)

```solidity
// AquaSwapVMRouter uses AquaOpcodes._opcodes()
// Only has 29 instructions (0x00-0x1C)
// opcodes[29] = OUT OF BOUNDS! 💥
```

### ✅ Using Custom Router (Works)

```solidity
// CustomSwapVMRouter uses MyCustomOpcodes._opcodes()
// Has 30 instructions (0x00-0x1D)
// opcodes[29] = FixedPriceSwap._fixedPriceSwapXD ✅
```

## Analogy

Think of it like a programming language:

- **FixedPriceAMM** = Compiler (converts your code to bytecode)
- **CustomSwapVMRouter** = Runtime/VM (executes the bytecode)

If the compiler uses instruction set A, but the runtime only knows instruction set B, they won't match!

## Summary

| Contract | Role | Opcodes Used |
|----------|------|--------------|
| `FixedPriceAMM` | **Builder** | `MyCustomOpcodes._opcodes()` (30 instructions) |
| `CustomSwapVMRouter` | **Executor** | `MyCustomOpcodes._opcodes()` (30 instructions) |
| `AquaSwapVMRouter` | **Executor** | `AquaOpcodes._opcodes()` (29 instructions) ❌ |

**The router is necessary because the executor must have the same opcodes table as the builder!**

## Can You Use Standard Router?

**No** - if you use `AquaSwapVMRouter` with `FixedPriceAMM`:
- Builder creates bytecode with opcode `0x1D`
- Executor doesn't know what `0x1D` is
- Result: **Array out of bounds error** 💥

You **must** use `CustomSwapVMRouter` (or create your own router with the same opcodes).


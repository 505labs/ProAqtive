# ProAqtivSwap.sol Implementation Analysis

## Executive Summary

The implementation has a **critical flaw** in how it determines `B0` (the initial equilibrium balance), which prevents it from correctly handling different reserve ratios. The mathematical formulas are correct, but the fundamental assumption about what `B0` represents is wrong.

## Critical Issue: B0 Definition

### The Problem

The code currently uses the **current balance** as `B0`:

```solidity
uint256 B0;
if (isTokenInBase) {
    B0 = ctx.swap.balanceIn; // Current balance, not equilibrium!
} else {
    B0 = ctx.swap.balanceOut; // Current balance, not equilibrium!
}
```

### Why This Is Wrong

The pricing formula is:
```
P_margin = i * (1 - k + k * (B0/B)^2)
```

Where:
- `B0` = **Initial equilibrium balance** (when pool matches oracle price)
- `B` = **Current base balance**
- `i` = Oracle price (normalized)

The formula measures how far the current balance `B` has drifted from the equilibrium balance `B0`. Using the current balance as `B0` means:
- The ratio `(B0/B)^2` is always close to 1 (since B0 ≈ B)
- The pricing doesn't account for how far from equilibrium the pool is
- Different reserve ratios aren't properly handled

### Example Scenario

**Setup:**
- Oracle price: 1 base = 2 quote
- Equilibrium reserves: 100 base, 200 quote
- Actual pool reserves: 50 base, 400 quote (drifted from equilibrium)

**Current Implementation:**
- B0 = 50 (current base balance) ❌
- B = 50 (current base balance)
- (B0/B)^2 = 1
- Pricing ignores the drift!

**Correct Implementation:**
- B0 = 100 (equilibrium base balance) ✅
- B = 50 (current base balance)
- (B0/B)^2 = (100/50)^2 = 4
- Pricing correctly accounts for being 2x away from equilibrium

## Impact on Reserve Ratio Handling

### The Core Problem

The implementation **does NOT properly handle different reserve ratios** because:

1. **B0 is incorrectly set** to current balance instead of equilibrium balance
2. **No mechanism to determine equilibrium** from oracle price
3. **Pricing doesn't account for drift** from equilibrium

### What Should Happen

When reserves don't match the oracle price:
- If pool has more base than equilibrium → price should be lower (incentivize selling base)
- If pool has less base than equilibrium → price should be higher (incentivize buying base)
- The `(B0/B)^2` term should amplify this effect based on `k`

### What Actually Happens

- B0 ≈ B (since B0 is set to current balance)
- (B0/B)^2 ≈ 1
- Pricing is mostly just the oracle price with minimal adjustment
- Reserve ratio doesn't meaningfully affect pricing

## Mathematical Correctness

### ✅ What's Correct

1. **Price normalization** from Pyth oracle (lines 115-122)
   - Correctly handles exponent and decimals
   - Properly converts to raw token units

2. **Integration formulas** (lines 140-195)
   - Selling base: `Delta Q = i * ((1-k)DeltaB + k * B0 * DeltaB / (B0 + DeltaB))`
   - Buying base: `Delta Q = i * ((1-k)DeltaB + k * B0 * DeltaB / (B0 - DeltaB))`
   - These are correct for the given pricing function

3. **Quadratic solver** (lines 198-256)
   - Logic is sound
   - Handles k=1 case correctly
   - General quadratic solution is correct

### ⚠️ Edge Cases Not Handled

1. **k = 0** (pure oracle price)
   - Not explicitly handled, but should work
   - Could be optimized for performance

2. **Division by zero**
   - Line 147: `B0 + amountIn` could theoretically be 0 (but unlikely)
   - Line 189: `B0 - deltaB` checked at line 186, but could be 0
   - Line 210: `B0 - C` could be 0

3. **Overflow risks**
   - Line 235: `b*b` can overflow for large values
   - Line 248: `b_signed * b_signed` can overflow

4. **Very small reserves**
   - No minimum reserve checks
   - Could lead to precision issues

## Test Coverage Analysis

Current tests only cover:
- ✅ Basic swap execution
- ✅ Stale price rejection
- ✅ EOA taker

Missing test cases:
- ❌ Different reserve ratios (equilibrium vs non-equilibrium)
- ❌ k = 0 (pure oracle)
- ❌ k = 1 (Uniswap style)
- ❌ Very small reserves
- ❌ Large swaps that approach B0
- ❌ Exact out with insufficient liquidity
- ❌ Overflow scenarios

## Recommendations

### 1. Fix B0 Determination (CRITICAL)

**Option A: Store B0 at liquidity provision**
- When maker ships liquidity, calculate equilibrium balance from oracle
- Store B0 in order data or as a parameter
- Requires modifying the AMM contract

**Option B: Calculate B0 from current reserves and oracle**
- B0 = Q / P_market (where Q is quote balance, P_market is oracle price)
- This assumes current reserves define equilibrium
- Simpler but less flexible

**Option C: Use initial reserves as B0**
- When liquidity is first provided, use that as B0
- Requires tracking initial state
- Most accurate for the intended use case

### 2. Add Safety Checks

```solidity
require(B0 > 0, "ProAquativeMM: B0 must be positive");
require(B0 + amountIn > 0, "ProAquativeMM: Overflow risk");
require(B0 > deltaB, "ProAquativeMM: Insufficient liquidity");
```

### 3. Add Overflow Protection

Use `unchecked` blocks carefully or use SafeMath-style checks for large multiplications.

### 4. Add Edge Case Handling

```solidity
if (k == 0) {
    // Pure oracle price - simpler calculation
    return (i * amountIn) / ONE;
}
```

### 5. Comprehensive Testing

Add tests for:
- Equilibrium vs non-equilibrium reserves
- Various k values (0, 0.5, 1)
- Edge cases (small reserves, large swaps)
- Different reserve ratios

## Conclusion

The implementation has **correct mathematical formulas** but a **fundamental flaw in B0 determination** that prevents it from correctly handling different reserve ratios. The pricing model is designed to account for drift from equilibrium, but the current implementation doesn't properly measure that drift.

**Severity:** 🔴 **HIGH** - Core functionality is broken for the intended use case

**Fix Priority:** 🔴 **CRITICAL** - Must fix B0 determination before production use



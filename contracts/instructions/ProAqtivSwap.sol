// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Calldata } from "@1inch/swap-vm/src/libs/Calldata.sol";
import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

/// @dev Minimal Pyth Interface
struct PythPrice {
    int64 price;
    uint64 conf;
    int32 expo;
    uint256 publishTime;
}

interface IPyth {
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (PythPrice memory);
}

library ProAquativeMMArgsBuilder {
    using Calldata for bytes;

    error ProAquativeMMMissingOracleArg();
    error ProAquativeMMMissingPriceIdArg();
    error ProAquativeMMMissingKArg();
    error ProAquativeMMMissingDecimalsArg();

    /**
     * @notice Builds arguments for ProAquativeMM swap instruction
     * @param pythOracle Address of the Pyth oracle contract
     * @param priceId The Pyth price feed ID
     * @param k The k parameter (0-1e18, where 1e18 = 100%)
     * @param maxStaleness Maximum age of price in seconds
     * @param isTokenInBase Whether tokenIn is the base token
     * @param baseDecimals Decimals of the base token
     * @param quoteDecimals Decimals of the quote token
     * @return args Encoded arguments for the instruction
     */
    function build(
        address pythOracle,
        bytes32 priceId,
        uint64 k,
        uint64 maxStaleness,
        bool isTokenInBase,
        uint8 baseDecimals,
        uint8 quoteDecimals
    ) internal pure returns (bytes memory args) {
        uint8 flags = isTokenInBase ? 1 : 0;
        return abi.encodePacked(
            pythOracle,      // 20 bytes
            priceId,          // 32 bytes
            k,                // 8 bytes
            maxStaleness,     // 8 bytes
            flags,            // 1 byte
            baseDecimals,     // 1 byte
            quoteDecimals     // 1 byte
        );
    }

    function parse(bytes calldata args) internal pure returns (
        address pythOracle,
        bytes32 priceId,
        uint64 k,
        uint64 maxStaleness,
        bool isTokenInBase,
        uint8 baseDecimals,
        uint8 quoteDecimals
    ) {
        pythOracle = address(bytes20(args.slice(0, 20, ProAquativeMMMissingOracleArg.selector)));
        priceId = bytes32(args.slice(20, 52, ProAquativeMMMissingPriceIdArg.selector));
        k = uint64(bytes8(args.slice(52, 60, ProAquativeMMMissingKArg.selector)));
        maxStaleness = uint64(bytes8(args.slice(60, 68, ProAquativeMMMissingDecimalsArg.selector)));
        uint8 flags = uint8(bytes1(args.slice(68, 69, ProAquativeMMMissingDecimalsArg.selector)));
        isTokenInBase = (flags & 1) == 1;
        baseDecimals = uint8(bytes1(args.slice(69, 70, ProAquativeMMMissingDecimalsArg.selector)));
        quoteDecimals = uint8(bytes1(args.slice(70, 71, ProAquativeMMMissingDecimalsArg.selector)));
    }
}

contract ProAquativeMM {
    using SafeCast for int256;
    using ContextLib for Context;

    error ProAquativeMMInvalidK();
    error ProAquativeMMPriceNegative();
    error ProAquativeMMInvalidEquilibrium();
    error ProAquativeMMInsufficientLiquidity();

    uint256 constant ONE = 1e18;
    uint256 constant MIN_RESERVE = 1e6; // Minimum reserve to prevent precision issues

    function _ProAquativeMMSwap(Context memory ctx, bytes calldata args) internal view {
        (
            address pythOracle,
            bytes32 priceId,
            uint64 k,
            uint64 maxStaleness,
            bool isTokenInBase,
            uint8 baseDecimals,
            uint8 quoteDecimals
        ) = ProAquativeMMArgsBuilder.parse(args);

        if (k > ONE) revert ProAquativeMMInvalidK();

        // 1. Get Price from Pyth (Price of Base in terms of Quote)
        IPyth pyth = IPyth(pythOracle);
        PythPrice memory p = pyth.getPriceNoOlderThan(priceId, maxStaleness);
        if (p.price <= 0) revert ProAquativeMMPriceNegative();

        // 2. Normalize Price to 18 decimals (assuming SwapVM uses 18 decimals internally or needs scaling)
        // P_market = price * 10^expo * 10^(18 - baseDecimals + quoteDecimals) ? 
        // Actually, if balances are raw, we want Price = RawQuote / RawBase.
        // Pyth Price = RealQuote / RealBase.
        // P_raw = P_real * 10^quoteDecimals / 10^baseDecimals
        // P_raw = (price * 10^expo) * 10^(quoteDecimals - baseDecimals)
        
        uint256 i; 
        int256 expo = p.expo + int256(uint256(quoteDecimals)) - int256(uint256(baseDecimals));
        
        if (expo >= 0) {
            i = uint256(int256(p.price)) * (10 ** uint256(expo));
        } else {
            i = uint256(int256(p.price)) / (10 ** uint256(-expo));
        }

        // 3. Determine Pool State and Calculate R (DODO PMM)
        // 
        // DODO PMM defines the price curve as: P = i * R
        // 
        // Where R depends on which reserve is scarce:
        // - If B < B0 (base is scarce):  R = 1 - k + (B0/B)^2 * k
        // - If Q < Q0 (quote is scarce): R = 1 / (1 - k + (Q0/Q)^2 * k)
        // - Otherwise (equilibrium):     R = 1
        //
        // At equilibrium: Q0 = i * B0 (both reserves match oracle price)
        
        // Get current balances
        uint256 B;  // Current base balance
        uint256 Q;  // Current quote balance
        
        if (isTokenInBase) {
            // Selling Base: In = Base, Out = Quote
            B = ctx.swap.balanceIn;
            Q = ctx.swap.balanceOut;
        } else {
            // Buying Base: In = Quote, Out = Base
            Q = ctx.swap.balanceIn;
            B = ctx.swap.balanceOut;
        }
        
        // Validate minimum reserves to prevent precision issues
        if (B < MIN_RESERVE || Q < MIN_RESERVE) revert ProAquativeMMInsufficientLiquidity();
        
        // Calculate equilibrium balances
        // We can derive B0 and Q0 from current reserves such that Q0 = i * B0
        // Using total value: V = B * i + Q
        // At equilibrium: V = B0 * i + Q0 = B0 * i + i * B0 = 2 * i * B0
        // Therefore: B0 = V / (2 * i) = (B * i + Q) / (2 * i)
        // And: Q0 = V / 2 = (B * i + Q) / 2
        
        uint256 totalValue = (B * i) / ONE + Q;  // Total value in quote units
        uint256 B0 = (totalValue * ONE) / (2 * i);  // Equilibrium base
        uint256 Q0 = totalValue / 2;                 // Equilibrium quote
        
        // Validate equilibrium balances
        if (B0 == 0 || Q0 == 0) revert ProAquativeMMInvalidEquilibrium();

        // 4. Perform Swap Calculations
        if (ctx.query.isExactIn) {
            uint256 amountIn = ctx.swap.amountIn;
            uint256 amountOut;
            
            if (isTokenInBase) {
                // Selling Base (Base increases) -> Receive Quote
                // Integration of PMM price curve:
                // Delta Q = i * ( (1-k)DeltaB + k * B0 * DeltaB / (B0 + DeltaB) )
                // where DeltaB = amountIn
                
                if (k == 0) {
                    // Pure oracle price (no slippage from inventory)
                    amountOut = (i * amountIn) / ONE;
                } else {
                    uint256 term1 = (uint256(ONE - k) * amountIn) / ONE;
                    uint256 term2 = (uint256(k) * B0 * amountIn) / ((B0 + amountIn) * ONE);
                    
                    // amountOut = i * (term1 + term2)
                    amountOut = (i * (term1 + term2)) / ONE;
                }
                
            } else {
                // Buying Base (Base decreases) -> Receive Base
                // We know Delta Q (amountIn), solve for Delta B (amountOut)
                // Integration formula: Delta Q = i * ( (1-k)DeltaB + k * B0 * DeltaB / (B0 - DeltaB) )
                // This requires solving a quadratic equation
                
                if (k == 0) {
                    // Pure oracle price (no slippage from inventory)
                    amountOut = (amountIn * ONE) / i;
                } else {
                    uint256 C = (amountIn * ONE) / i; // C = DeltaQ / i
                    amountOut = _solveQuadratic(k, B0, C, true); // true for "Buying Base" form
                }
                
                // Validate we're not draining all base tokens
                if (amountOut >= B) revert ProAquativeMMInsufficientLiquidity();
            }
            
            ctx.swap.amountOut = amountOut;
            
        } else {
            // Exact Out
            uint256 amountOut = ctx.swap.amountOut;
            uint256 amountIn;
            
            if (isTokenInBase) {
                // Selling Base (Exact Quote Out)
                // We know Delta Q (amountOut), solve for Delta B (amountIn)
                // Equation: Delta Q = i * ( (1-k)DeltaB + k * B0 * DeltaB / (B0 + DeltaB) )
                
                if (k == 0) {
                    // Pure oracle price (no slippage from inventory)
                    amountIn = Math.ceilDiv(amountOut * ONE, i);
                } else {
                    uint256 C = (amountOut * ONE) / i;
                    amountIn = _solveQuadratic(k, B0, C, false); // false for "Selling Base" form
                }
                
            } else {
                // Buying Base (Exact Base Out)
                // We know Delta B (amountOut). Calculate Delta Q (amountIn)
                // Integration formula: Delta Q = i * ( (1-k)DeltaB + k * B0 * DeltaB / (B0 - DeltaB) )
                
                uint256 deltaB = amountOut;
                
                // Safety: Cannot buy more base than exists in the pool
                if (deltaB >= B) revert ProAquativeMMInsufficientLiquidity();
                
                if (k == 0) {
                    // Pure oracle price (no slippage from inventory)
                    amountIn = Math.ceilDiv(i * deltaB, ONE);
                } else {
                    uint256 term1 = (uint256(ONE - k) * deltaB) / ONE;
                    uint256 term2 = (uint256(k) * B0 * deltaB) / ((B0 - deltaB) * ONE);
                    
                    amountIn = Math.ceilDiv(i * (term1 + term2), ONE);
                }
            }
            
            ctx.swap.amountIn = amountIn;
        }
    }

    /**
     * @dev Solves quadratic equation for PMM integration
     * @param k Slippage parameter (0-1e18)
     * @param B0 Equilibrium base balance
     * @param C Normalized amount (DeltaQ / i)
     * @param isBuyingBase True if buying base (base decreases), false if selling base (base increases)
     * @return x The solution (Delta B)
     */
    function _solveQuadratic(uint64 k, uint256 B0, uint256 C, bool isBuyingBase) private pure returns (uint256 x) {
        // Validate inputs
        if (B0 == 0) revert ProAquativeMMInvalidEquilibrium();
        if (C == 0) return 0;
        
        if (k == 1e18) {
            // k=1: Maximum slippage (Uniswap-style constant product)
            // Buying Base: C = B0 * x / (B0 - x) => x = C * B0 / (C + B0)
            // Selling Base: C = B0 * x / (B0 + x) => x = C * B0 / (B0 - C)
            if (isBuyingBase) {
                return (C * B0) / (C + B0);
            } else {
                // If C >= B0, insufficient liquidity for the desired output
                if (C >= B0) revert ProAquativeMMInsufficientLiquidity();
                return (C * B0) / (B0 - C);
            }
        }

        // General case: Solve quadratic equation
        // Buying Base:  (1-k)x^2 - (C + B0)x + C*B0 = 0
        // Selling Base: (1-k)x^2 + (B0 - C)x - C*B0 = 0
        
        uint256 oneMinusK = 1e18 - k;
        uint256 a = oneMinusK;
        
        // Safety: oneMinusK should be > 0 since we already handled k=1e18 case
        if (a == 0) revert ProAquativeMMInvalidK();
        
        if (isBuyingBase) {
            // (1-k)x^2 - (C + B0)x + C*B0 = 0
            // x = (b - sqrt(b^2 - 4ac)) / 2a  (We want the smaller root: x < B0)
            
            uint256 b = (C + B0) * 1e18;
            uint256 c_val = (C * B0) * 1e18;
            
            // Calculate discriminant: b^2 - 4ac
            uint256 fourAC = 4 * a * c_val;
            uint256 bSquared = b * b;
            
            // Validate discriminant is non-negative
            if (bSquared < fourAC) revert ProAquativeMMInsufficientLiquidity();
            
            uint256 discriminant = bSquared - fourAC;
            uint256 sqrtD = Math.sqrt(discriminant);
            
            // x = (b - sqrtD) / 2a
            x = (b - sqrtD) / (2 * a);
            
        } else {
            // (1-k)x^2 + (B0 - C)x - C*B0 = 0
            // x = (-b + sqrt(b^2 + 4ac)) / 2a  (We want the positive root)
            
            int256 b_signed = (int256(B0) - int256(C)) * int256(1e18);
            uint256 c_val = (C * B0) * 1e18;
            
            // Calculate discriminant: b^2 + 4ac (note: c is negative in standard form)
            uint256 fourAC = 4 * a * c_val;
            uint256 bSquared = uint256(b_signed * b_signed);
            uint256 discriminant = bSquared + fourAC;
            uint256 sqrtD = Math.sqrt(discriminant);
            
            // x = (-b + sqrtD) / 2a
            int256 numerator = -b_signed + int256(sqrtD);
            
            // Ensure numerator is positive
            if (numerator <= 0) revert ProAquativeMMInsufficientLiquidity();
            
            x = uint256(numerator) / (2 * a);
        }
        
        // Final validation: result should be reasonable
        if (x == 0 && C > 0) revert ProAquativeMMInsufficientLiquidity();
    }
}
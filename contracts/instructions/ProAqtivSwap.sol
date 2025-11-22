// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
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

    uint256 constant ONE = 1e18;

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

        // 3. Perform Swap Math
        // B0 = Current Base Balance (Assuming Equilibrium start)
        // B = Current Base Balance
        // P_margin = i * (1 - k + k * (B0/B)^2)
        
        uint256 B0;
        if (isTokenInBase) {
            B0 = ctx.swap.balanceIn; // We are selling Base, so In is Base
        } else {
            B0 = ctx.swap.balanceOut; // We are buying Base, so Out is Base
        }

        if (ctx.query.isExactIn) {
            uint256 amountIn = ctx.swap.amountIn;
            uint256 amountOut;
            
            if (isTokenInBase) {
                // Selling Base (Base increases) -> Receive Quote
                // amountOut (Quote) = Integral of Price
                // Delta Q = i * ( (1-k)DeltaB + k * B0 * DeltaB / (B0 + DeltaB) )
                // Delta B = amountIn
                
                uint256 term1 = (uint256(ONE - k) * amountIn) / ONE;
                uint256 term2 = (uint256(k) * B0 * amountIn) / (B0 + amountIn) / ONE;
                
                // amountOut = i * (term1 + term2)
                amountOut = (i * (term1 + term2)) / ONE;
                
            } else {
                // Selling Quote (Base decreases) -> Receive Base
                // We know Delta Q (amountIn), solve for Delta B (amountOut)
                // Delta Q = i * ( (1-k)DeltaB + k * B0 * DeltaB / (B0 - DeltaB) )
                // Solve Quadratic for DeltaB
                
                uint256 C = (amountIn * ONE) / i; // C = DeltaQ / i
                
                amountOut = _solveQuadratic(k, B0, C, true); // true for "Buying Base" form
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
                
                uint256 C = (amountOut * ONE) / i;
                amountIn = _solveQuadratic(k, B0, C, false); // false for "Selling Base" form
                
            } else {
                // Buying Base (Exact Base Out)
                // We know Delta B (amountOut). Calculate Delta Q (amountIn)
                // Base Decreases.
                // Delta Q = i * ( (1-k)DeltaB + k * B0 * DeltaB / (B0 - DeltaB) )
                
                uint256 deltaB = amountOut;
                // Safety: Cannot buy more base than exists (approaching B0)
                require(deltaB < B0, "ProAquativeMM: Insufficient Liquidity");
                
                uint256 term1 = (uint256(ONE - k) * deltaB) / ONE;
                uint256 term2 = (uint256(k) * B0 * deltaB) / (B0 - deltaB) / ONE;
                
                amountIn = Math.ceilDiv(i * (term1 + term2), ONE);
            }
            
            ctx.swap.amountIn = amountIn;
        }
    }

    function _solveQuadratic(uint64 k, uint256 B0, uint256 C, bool isBuyingBase) private pure returns (uint256 x) {
        // Solving for x (Delta B)
        
        if (k == 1e18) {
            // k=1 (Uniswap Style)
            // Buying Base: C = B0 * x / (B0 - x) => x = C * B0 / (C + B0)
            // Selling Base: C = B0 * x / (B0 + x) => x = C * B0 / (B0 - C) (if C < B0, else infinity?)
            if (isBuyingBase) {
                return (C * B0) / (C + B0);
            } else {
                // Note: If C >= B0, this implies infinite slippage or invalid state for k=1
                require(B0 > C, "ProAquativeMM: Insufficient Liquidity for ExactOut");
                return (C * B0) / (B0 - C);
            }
        }

        // General Quadratic: (1-k)x^2 + LinearTerm*x + Constant = 0
        // Buying Base: (1-k)x^2 - (C + B0)x + C*B0 = 0
        // Selling Base: (1-k)x^2 + (B0 - C)x - C*B0 = 0
        
        uint256 oneMinusK = 1e18 - k;
        
        uint256 a = oneMinusK;
        uint256 b;
        uint256 c_term = (C * B0); // Scaled? No, coefficients relative.
        
        // Normalize precision if needed, but here x, B0, C are same units.
        // However, a is 1e18 scale. We need to be careful with multiplication.
        // Equation: a/1e18 * x^2 + b * x + c = 0
        // => a * x^2 + b * 1e18 * x + c * 1e18 = 0
        
        if (isBuyingBase) {
            // (1-k)x^2 - (C + B0)x + C*B0 = 0
            b = (C + B0) * 1e18;
            uint256 c_val = c_term * 1e18;
            
            // x = (b - sqrt(b^2 - 4ac)) / 2a  (We want smaller root x < B0)
            uint256 discriminant = b*b - 4 * a * c_val;
            uint256 sqrtD = Math.sqrt(discriminant);
            x = (b - sqrtD) / (2 * a);
            
        } else {
            // (1-k)x^2 + (B0 - C)x - C*B0 = 0
            // x = (-b + sqrt(b^2 - 4ac)) / 2a (Positive root)
            // b_term can be negative if C > B0.
            
            int256 b_signed = (int256(B0) - int256(C)) * 1e18; 
            uint256 c_val = c_term * 1e18;
            
            // discriminant = b^2 - 4*a*(-c) = b^2 + 4ac
            uint256 discriminant = uint256(b_signed * b_signed) + 4 * a * c_val;
            uint256 sqrtD = Math.sqrt(discriminant);
            
            // x = (-b + sqrtD) / 2a
            // If b is negative, -b is positive.
            int256 num = -b_signed + int256(sqrtD);
            x = uint256(num) / (2 * a);
        }
    }
}
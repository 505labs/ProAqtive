// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { DecimalMath } from "../libs/DecimalMath.sol";
import { DODOMath } from "../libs/DODOMath.sol";
import { Types } from "../libs/Types.sol";
import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @title DODOSwap
/// @notice DODO Proactive Market Maker (PMM) algorithm compatible with SwapVM
/// @dev Implements full PMM with k parameter and oracle-based pricing
contract DODOSwap {
    using ContextLib for Context;
    using DecimalMath for uint256;

    // ============ Errors ============

    error DODOSwapRecomputeDetected();
    error DODOSwapRequiresBothBalancesNonZero(uint256 balanceIn, uint256 balanceOut);
    error DODOSwapInvalidKParameter(uint256 k);
    error DODOSwapInsufficientLiquidity();

    // ============ Structs ============

    /// @notice Parameters passed via args for stateless operation
    /// @param pythContract Address of the Pyth contract for oracle updates
    /// @param priceFeedId Pyth price feed ID (e.g., ETH/USD feed ID)
    /// @param maxStaleness Maximum acceptable price age in seconds (e.g., 60)
    /// @param k Liquidity depth parameter (0 to 1e18, where 0 = constant sum, 1e18 = constant product)
    /// @param targetBaseAmount Target base token balance (equilibrium point)
    /// @param targetQuoteAmount Target quote token balance (equilibrium point)
    /// @param baseIsTokenIn True if base token is the input token, false if quote token is input
    /// @dev Price must be updated separately before calling swap (see updatePriceFeeds on IPyth)
    struct DODOParams {
        address pythContract;
        bytes32 priceFeedId;
        uint256 maxStaleness;
        uint256 k;
        uint256 targetBaseAmount;
        uint256 targetQuoteAmount;
        bool baseIsTokenIn;
    }

    // ============ R Status Derivation ============

    /// @notice Derive R status from current base and quote supplies
    /// @dev Based on PMM Price Curve:
    ///      - If B < B₀, then R < 1 (BELOW_ONE)
    ///      - If Q < Q₀, then R > 1 (ABOVE_ONE)
    ///      - Otherwise, R = 1 (ONE)
    /// @param baseBalance Current base token supply
    /// @param quoteBalance Current quote token supply
    /// @param targetBaseAmount Equilibrium base token supply (B₀)
    /// @param targetQuoteAmount Equilibrium quote token supply (Q₀)
    /// @return The derived R status
    function _getRStatus(
        uint256 baseBalance,
        uint256 quoteBalance,
        uint256 targetBaseAmount,
        uint256 targetQuoteAmount
    ) internal pure returns (Types.RStatus) {
        if (baseBalance < targetBaseAmount) {
            return Types.RStatus.BELOW_ONE;
        } else if (quoteBalance < targetQuoteAmount) {
            return Types.RStatus.ABOVE_ONE;
        } else {
            return Types.RStatus.ONE;
        }
    }

    // ============ Main Swap Function ============

    /// @notice Execute DODO swap using PMM algorithm with Pyth oracle
    /// @dev Compatible with SwapVM architecture
    /// @dev Price must be updated separately before calling swap (via pyth.updatePriceFeeds)
    /// @param ctx Swap context from SwapVM
    /// @param args Encoded DODOParams (without price update data)
    function _dodoSwapXD(Context memory ctx, bytes calldata args) internal view {
        // Validate balances
        if (!(ctx.swap.balanceIn > 0 && ctx.swap.balanceOut > 0)) {
            revert DODOSwapRequiresBothBalancesNonZero(ctx.swap.balanceIn, ctx.swap.balanceOut);
        }

        // Decode parameters
        DODOParams memory params = abi.decode(args, (DODOParams));
        
        // Validate k parameter (k must be in range [0, 1) - k = 1 causes division by zero)
        if (params.k >= DecimalMath.ONE) {
            revert DODOSwapInvalidKParameter(params.k);
        }

        // Initialize Pyth interface
        IPyth pyth = IPyth(params.pythContract);
        
        // Get the current price from Pyth (must be updated separately before swap)
        // This will revert if the price is older than maxStaleness
        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(
            params.priceFeedId,
            params.maxStaleness
        );
        
        // Convert Pyth price to our format (18 decimals)
        // Pyth price has 'expo' as the exponent (negative for most prices)
        // Formula: price = pythPrice.price * 10^(18 + pythPrice.expo)
        uint256 oraclePrice = _convertPythPrice(pythPrice);

        // Determine base and quote balances based on swap direction
        uint256 baseBalance;
        uint256 quoteBalance;
        
        if (params.baseIsTokenIn) {
            baseBalance = ctx.swap.balanceIn;
            quoteBalance = ctx.swap.balanceOut;
        } else {
            baseBalance = ctx.swap.balanceOut;
            quoteBalance = ctx.swap.balanceIn;
        }

        // Derive R status from current balances
        Types.RStatus rStatus = _getRStatus(
            baseBalance,
            quoteBalance,
            params.targetBaseAmount,
            params.targetQuoteAmount
        );

        // Execute swap based on direction
        if (ctx.query.isExactIn) {
            // Prevent recomputation
            if (ctx.swap.amountOut != 0) {
                revert DODOSwapRecomputeDetected();
            }
            
            // Calculate amountOut based on R status
            ctx.swap.amountOut = _calculateAmountOut(
                ctx.swap.amountIn,
                ctx.swap.balanceIn,
                ctx.swap.balanceOut,
                params.targetBaseAmount,
                params.targetQuoteAmount,
                rStatus,
                oraclePrice,
                params.k
            );
        } else {
            // Prevent recomputation
            if (ctx.swap.amountIn != 0) {
                revert DODOSwapRecomputeDetected();
            }
            
            // Calculate amountIn based on R status
            ctx.swap.amountIn = _calculateAmountIn(
                ctx.swap.amountOut,
                ctx.swap.balanceIn,
                ctx.swap.balanceOut,
                params.targetBaseAmount,
                params.targetQuoteAmount,
                rStatus,
                oraclePrice,
                params.k
            );
        }
    }

    // ============ Internal Calculation Functions ============

    /// @notice Calculate output amount for exact input swap
    function _calculateAmountOut(
        uint256 amountIn,
        uint256 balanceIn,
        uint256 balanceOut,
        uint256 targetBaseAmount,
        uint256 targetQuoteAmount,
        Types.RStatus rStatus,
        uint256 oraclePrice,
        uint256 k
    ) internal pure returns (uint256) {
        if (rStatus == Types.RStatus.ONE) {
            // Balanced state: selling base for quote
            return _ROneSellBaseToken(amountIn, targetQuoteAmount, oraclePrice, k);
        } else if (rStatus == Types.RStatus.BELOW_ONE) {
            // Excess base: selling base for quote
            return _RBelowSellBaseToken(amountIn, balanceOut, targetQuoteAmount, oraclePrice, k);
        } else {
            // Excess quote: selling base for quote (buying back to equilibrium)
            return _RAboveSellBaseToken(amountIn, balanceIn, targetBaseAmount, oraclePrice, k);
        }
    }

    /// @notice Calculate input amount for exact output swap
    function _calculateAmountIn(
        uint256 amountOut,
        uint256 balanceIn,
        uint256 balanceOut,
        uint256 targetBaseAmount,
        uint256 targetQuoteAmount,
        Types.RStatus rStatus,
        uint256 oraclePrice,
        uint256 k
    ) internal pure returns (uint256) {
        if (rStatus == Types.RStatus.ONE) {
            // Balanced state: buying base with quote
            return _ROneBuyBaseToken(amountOut, targetBaseAmount, oraclePrice, k);
        } else if (rStatus == Types.RStatus.BELOW_ONE) {
            // Excess base: buying base with quote (buying back to equilibrium)
            return _RBelowBuyBaseToken(amountOut, balanceOut, targetQuoteAmount, oraclePrice, k);
        } else {
            // Excess quote: buying base with quote
            return _RAboveBuyBaseToken(amountOut, balanceIn, targetBaseAmount, oraclePrice, k);
        }
    }

    // ============ R = ONE Cases (Balanced) ============

    /// @notice Sell base token when R = ONE
    function _ROneSellBaseToken(
        uint256 amount,
        uint256 targetQuoteAmount,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256 receiveQuoteToken) {
        uint256 Q2 = DODOMath._SolveQuadraticFunctionForTrade(
            targetQuoteAmount,
            targetQuoteAmount,
            DecimalMath.mul(i, amount),
            false,
            k
        );
        return targetQuoteAmount - Q2;
    }

    /// @notice Buy base token when R = ONE
    function _ROneBuyBaseToken(
        uint256 amount,
        uint256 targetBaseAmount,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256 payQuoteToken) {
        if (amount >= targetBaseAmount) {
            revert DODOSwapInsufficientLiquidity();
        }
        uint256 B2 = targetBaseAmount - amount;
        return _RAboveIntegrate(targetBaseAmount, targetBaseAmount, B2, i, k);
    }

    // ============ R < ONE Cases (Excess Base) ============

    /// @notice Sell base token when R < ONE
    function _RBelowSellBaseToken(
        uint256 amount,
        uint256 quoteBalance,
        uint256 targetQuoteAmount,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256 receiveQuoteToken) {
        uint256 Q2 = DODOMath._SolveQuadraticFunctionForTrade(
            targetQuoteAmount,
            quoteBalance,
            DecimalMath.mul(i, amount),
            false,
            k
        );
        return quoteBalance - Q2;
    }

    /// @notice Buy base token when R < ONE
    function _RBelowBuyBaseToken(
        uint256 amount,
        uint256 quoteBalance,
        uint256 targetQuoteAmount,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256 payQuoteToken) {
        uint256 Q2 = DODOMath._SolveQuadraticFunctionForTrade(
            targetQuoteAmount,
            quoteBalance,
            DecimalMath.mulCeil(i, amount),
            true,
            k
        );
        return Q2 - quoteBalance;
    }

    // ============ R > ONE Cases (Excess Quote) ============

    /// @notice Buy base token when R > ONE
    function _RAboveBuyBaseToken(
        uint256 amount,
        uint256 baseBalance,
        uint256 targetBaseAmount,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256 payQuoteToken) {
        if (amount >= baseBalance) {
            revert DODOSwapInsufficientLiquidity();
        }
        uint256 B2 = baseBalance - amount;
        return _RAboveIntegrate(targetBaseAmount, baseBalance, B2, i, k);
    }

    /// @notice Sell base token when R > ONE
    function _RAboveSellBaseToken(
        uint256 amount,
        uint256 baseBalance,
        uint256 targetBaseAmount,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256 receiveQuoteToken) {
        uint256 B1 = baseBalance + amount;
        return _RAboveIntegrate(targetBaseAmount, B1, baseBalance, i, k);
    }

    // ============ Helper Functions ============

    /// @notice Integration helper for R > ONE cases
    function _RAboveIntegrate(
        uint256 B0,
        uint256 B1,
        uint256 B2,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256) {
        return DODOMath._GeneralIntegrate(B0, B1, B2, i, k);
    }

    /// @notice Convert Pyth price format to 18 decimal format
    /// @dev Pyth prices come with an exponent (usually negative)
    /// @dev Formula: finalPrice = pythPrice.price * 10^(18 + pythPrice.expo)
    /// @param pythPrice The price struct from Pyth
    /// @return price The price scaled to 18 decimals
    function _convertPythPrice(PythStructs.Price memory pythPrice) internal pure returns (uint256) {
        // Pyth price format: price * 10^expo
        // We need to convert to 18 decimals
        // Example: If Pyth returns price=3000.50 as (300050, expo=-2)
        // We need: 3000.50 * 10^18 = 300050 * 10^(18-2) = 300050 * 10^16
        
        int64 price = pythPrice.price;
        int32 expo = pythPrice.expo;
        
        // Ensure price is positive (negative prices don't make sense for our use case)
        require(price > 0, "DODOSwap: Negative price");
        
        uint256 absPrice = uint256(uint64(price));
        
        // Calculate the scaling factor: 10^(18 + expo)
        // If expo = -8, we need 10^(18-8) = 10^10
        // If expo = -2, we need 10^(18-2) = 10^16
        int256 exponent = int256(18) + int256(expo);
        
        if (exponent >= 0) {
            // Positive exponent: multiply
            return absPrice * (10 ** uint256(exponent));
        } else {
            // Negative exponent: divide
            return absPrice / (10 ** uint256(-exponent));
        }
    }
}


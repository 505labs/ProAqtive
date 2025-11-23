// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { DecimalMath } from "./contracts/libs/DecimalMath.sol";
import { DODOMath } from "./contracts/libs/DODOMath.sol";
import { Types } from "./contracts/libs/Types.sol";
import { IPriceOracle } from "./contracts/interfaces/IPriceOracle.sol";

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
    /// @param oracle Address of the price oracle contract
    /// @param k Liquidity depth parameter (0 to 1e18, where 0 = constant sum, 1e18 = constant product)
    /// @param targetBaseAmount Target base token balance (equilibrium point)
    /// @param targetQuoteAmount Target quote token balance (equilibrium point)
    /// @param baseIsTokenIn True if base token is the input token, false if quote token is input
    struct DODOParams {
        address oracle;
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

    /// @notice Execute DODO swap using PMM algorithm
    /// @dev Compatible with SwapVM architecture
    /// @param ctx Swap context from SwapVM
    /// @param args Encoded DODOParams
    function _dodoSwapXD(Context memory ctx, bytes calldata args) internal view {
        // Validate balances
        require(
            ctx.swap.balanceIn > 0 && ctx.swap.balanceOut > 0,
            DODOSwapRequiresBothBalancesNonZero(ctx.swap.balanceIn, ctx.swap.balanceOut)
        );

        // Decode parameters
        DODOParams memory params = abi.decode(args, (DODOParams));
        
        // Validate k parameter
        require(params.k <= DecimalMath.ONE, DODOSwapInvalidKParameter(params.k));

        // Get oracle price
        uint256 oraclePrice = IPriceOracle(params.oracle).getPrice();

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
            require(ctx.swap.amountOut == 0, DODOSwapRecomputeDetected());
            
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
            require(ctx.swap.amountIn == 0, DODOSwapRecomputeDetected());
            
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
        require(amount < targetBaseAmount, DODOSwapInsufficientLiquidity());
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
        require(amount < baseBalance, DODOSwapInsufficientLiquidity());
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
}


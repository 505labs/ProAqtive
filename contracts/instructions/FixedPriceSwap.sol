// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Context, ContextLib } from "@1inch/swap-vm/src/libs/VM.sol";

/**
 * @title FixedPriceSwap
 * @notice Example custom instruction that implements a 1:1 fixed price swap
 * 
 * This demonstrates how to create a custom instruction for SwapVM.
 * The instruction always swaps at a 1:1 ratio regardless of reserves.
 */
contract FixedPriceSwap {
    using ContextLib for Context;

    error InsufficientBalance();

    /**
     * @notice Fixed price swap instruction - always swaps 1:1
     * @param ctx The SwapVM context containing balances and amounts
     * 
     * This instruction:
     * - For exactIn: amountOut = amountIn (1:1 ratio)
     * - For exactOut: amountIn = amountOut (1:1 ratio)
     * - Checks that sufficient balance exists
     */
    function _fixedPriceSwapXD(Context memory ctx, bytes calldata /* args */) internal pure {
        if (ctx.query.isExactIn) {
            // 1:1 swap - output equals input
            ctx.swap.amountOut = ctx.swap.amountIn;
            
            // Check we have enough balance
            if (ctx.swap.balanceOut < ctx.swap.amountOut) {
                revert InsufficientBalance();
            }
        } else {
            // Reverse: input equals output
            ctx.swap.amountIn = ctx.swap.amountOut;
            
            // Check we have enough balance
            if (ctx.swap.balanceIn < ctx.swap.amountIn) {
                revert InsufficientBalance();
            }
        }
    }
}


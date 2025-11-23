// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { ISwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { ProgramBuilder, Program } from "@1inch/swap-vm/test/utils/ProgramBuilder.sol";
import { MyCustomOpcodes } from "./MyCustomOpcodes.sol";
import { ProAquativeMMArgsBuilder } from "./instructions/ProAqtivSwap.sol";

/**
 * @title ProAquativeAMM
 * @notice AMM using DODO-inspired Proactive Market Maker (PMM) with Pyth oracle pricing
 * 
 * This AMM implements a sophisticated pricing model inspired by DODO's PMM algorithm:
 * - Integrates Pyth oracle for real-time market price feeds
 * - Dynamically calculates equilibrium balance (B0) from current reserves and oracle price
 * - Implements regression target calculations for price adjustments based on inventory deviation
 * - Properly handles different reserve ratios
 * 
 * PMM Pricing Formula: P_margin = P_market * (1 - k + k * (B0/B)^2)
 * 
 * Where:
 * - P_market: Real-time price from Pyth oracle (normalized to token decimals)
 * - k: Slippage parameter (0-1e18, where 1e18 = 100%)
 *   - k=0: Pure oracle price (no slippage from inventory)
 *   - k=1: Maximum slippage (Uniswap-style constant product)
 * - B0: Equilibrium base token balance (calculated as B0 = Q / P_market)
 *   - Represents the balance where pool matches oracle price
 *   - Calculated dynamically from current reserves
 * - B: Current base token balance
 * 
 * Regression Target Behavior:
 * - When B < B0: Pool has less base than equilibrium → price increases
 * - When B > B0: Pool has more base than equilibrium → price decreases
 * - The k parameter controls how strongly inventory deviation affects pricing
 * 
 * This allows the AMM to proactively adjust prices to guide the pool back toward equilibrium,
 * while minimizing slippage and maintaining efficient capital utilization.
 */
contract ProAquativeAMM is MyCustomOpcodes {
    using ProgramBuilder for Program;

    constructor(address aqua) MyCustomOpcodes(aqua) {}
    
    /**
     * @notice Builds a DODO-inspired PMM order with dynamic equilibrium calculation
     * @param maker The address providing liquidity
     * @param pythOracle Address of the Pyth oracle contract for real-time price feeds
     * @param priceId The Pyth price feed ID (bytes32) - must match the base/quote pair
     * @param k The slippage parameter (0-1e18, where 1e18 = 100%)
     *        - k=0: Pure oracle pricing with no inventory-based slippage
     *        - k=1: Maximum slippage (Uniswap-style constant product)
     *        - Recommended: 0.1e18 to 0.5e18 for balanced behavior
     * @param maxStaleness Maximum age of oracle price in seconds (e.g., 60 for 1 minute)
     * @param isTokenInBase Whether tokenIn is the base token (true) or quote token (false)
     *        - Base token: The asset being priced (e.g., ETH in ETH/USDC)
     *        - Quote token: The pricing currency (e.g., USDC in ETH/USDC)
     * @param baseDecimals Decimals of the base token (e.g., 18 for ETH)
     * @param quoteDecimals Decimals of the quote token (e.g., 6 for USDC)
     * @return order The SwapVM order with the ProAquativeMM swap program
     * 
     * @dev The contract dynamically calculates B0 (equilibrium balance) as B0 = Q / P_market
     *      where Q is the current quote balance and P_market is the normalized oracle price.
     *      No need to pass B0 as a parameter - it's computed on every swap.
     */
    function buildProgram(
        address maker,
        address pythOracle,
        bytes32 priceId,
        uint64 k,
        uint64 maxStaleness,
        bool isTokenInBase,
        uint8 baseDecimals,
        uint8 quoteDecimals
    ) external pure returns (ISwapVM.Order memory) {
        // Initialize program builder with our extended opcodes
        Program memory program = ProgramBuilder.init(_opcodes());
        
        // Build arguments for ProAquativeMM instruction
        bytes memory args = ProAquativeMMArgsBuilder.build(
            pythOracle,
            priceId,
            k,
            maxStaleness,
            isTokenInBase,
            baseDecimals,
            quoteDecimals
        );
        
        // Build bytecode using our custom instruction (opcode 0x1E = 30)
        bytes memory bytecode = program.build(_ProAquativeMMSwap, args);
        
        // Build and return the order
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


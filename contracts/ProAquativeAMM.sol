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
 * @notice AMM using ProAquativeMM instruction with Pyth oracle-based pricing
 * 
 * This AMM uses a sophisticated pricing model that:
 * - Uses Pyth oracle for market price
 * - Applies a k parameter to adjust pricing based on liquidity depth
 * - Formula: P_margin = P_market * (1 - k + k * (B0/B)^2)
 * 
 * Where:
 * - P_market: Price from Pyth oracle
 * - k: Parameter (0-1) controlling how much liquidity depth affects price
 * - B0: Initial base token balance
 * - B: Current base token balance
 */
contract ProAquativeAMM is MyCustomOpcodes {
    using ProgramBuilder for Program;

    /**
     * @notice Hook configuration struct for buildProgram
     */
    struct HookConfig {
        bool hasPreTransferInHook;
        bool hasPostTransferInHook;
        bool hasPreTransferOutHook;
        bool hasPostTransferOutHook;
        address preTransferInTarget;
        address postTransferInTarget;
        address preTransferOutTarget;
        address postTransferOutTarget;
        bytes preTransferInData;
        bytes postTransferInData;
        bytes preTransferOutData;
        bytes postTransferOutData;
    }

    constructor(address aqua) MyCustomOpcodes(aqua) {}
    
    /**
     * @notice Builds a ProAquativeMM order (without hooks)
     * @param maker The address providing liquidity
     * @param pythOracle Address of the Pyth oracle contract
     * @param priceId The Pyth price feed ID (bytes32)
     * @param k The k parameter (0-1e18, where 1e18 = 100%). Higher k = more liquidity depth impact
     * @param maxStaleness Maximum age of price in seconds
     * @param isTokenInBase Whether tokenIn is the base token (true) or quote token (false)
     * @param baseDecimals Decimals of the base token
     * @param quoteDecimals Decimals of the quote token
     * @return order The SwapVM order with the ProAquativeMM swap program
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
        return buildProgram(
            maker,
            pythOracle,
            priceId,
            k,
            maxStaleness,
            isTokenInBase,
            baseDecimals,
            quoteDecimals,
            HookConfig({
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                postTransferInTarget: address(0),
                preTransferOutTarget: address(0),
                postTransferOutTarget: address(0),
                preTransferInData: "",
                postTransferInData: "",
                preTransferOutData: "",
                postTransferOutData: ""
            })
        );
    }
    
    /**
     * @notice Builds a ProAquativeMM order with hook configuration
     * @param maker The address providing liquidity
     * @param pythOracle Address of the Pyth oracle contract
     * @param priceId The Pyth price feed ID (bytes32)
     * @param k The k parameter (0-1e18, where 1e18 = 100%). Higher k = more liquidity depth impact
     * @param maxStaleness Maximum age of price in seconds
     * @param isTokenInBase Whether tokenIn is the base token (true) or quote token (false)
     * @param baseDecimals Decimals of the base token
     * @param quoteDecimals Decimals of the quote token
     * @param hookConfig Hook configuration for pre/post transfer hooks
     * @return order The SwapVM order with the ProAquativeMM swap program
     */
    function buildProgram(
        address maker,
        address pythOracle,
        bytes32 priceId,
        uint64 k,
        uint64 maxStaleness,
        bool isTokenInBase,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        HookConfig memory hookConfig
    ) public pure returns (ISwapVM.Order memory) {
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
            hasPreTransferInHook: hookConfig.hasPreTransferInHook,
            hasPostTransferInHook: hookConfig.hasPostTransferInHook,
            hasPreTransferOutHook: hookConfig.hasPreTransferOutHook,
            hasPostTransferOutHook: hookConfig.hasPostTransferOutHook,
            preTransferInTarget: hookConfig.preTransferInTarget,
            preTransferInData: hookConfig.preTransferInData,
            postTransferInTarget: hookConfig.postTransferInTarget,
            postTransferInData: hookConfig.postTransferInData,
            preTransferOutTarget: hookConfig.preTransferOutTarget,
            preTransferOutData: hookConfig.preTransferOutData,
            postTransferOutTarget: hookConfig.postTransferOutTarget,
            postTransferOutData: hookConfig.postTransferOutData,
            program: bytecode
        }));
    }
}


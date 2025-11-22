// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { ISwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { ProgramBuilder, Program } from "@1inch/swap-vm/test/utils/ProgramBuilder.sol";

/**
 * @title SimpleConstantProductAMM
 * @notice A minimal AMM implementation using SwapVM's constant product formula (x * y = k)
 * 
 * This is a simplified version that demonstrates the basic constant product AMM without
 * any additional features like fees, decay, or liquidity concentration.
 * 
 * How it works:
 * 1. The contract builds a SwapVM program using only the XYC_SWAP_XD instruction
 * 2. XYC_SWAP_XD implements the constant product formula: reserve0 * reserve1 = constant
 * 3. When a swap occurs, the formula ensures: (reserve0 + amountIn) * (reserve1 - amountOut) = k
 * 4. The SwapVM executes this program to perform the swap
 */
contract SimpleConstantProductAMM is AquaOpcodes {
    using ProgramBuilder for Program;

    constructor(address aqua) AquaOpcodes(aqua) {}

    /**
     * @notice Builds a simple constant product AMM order
     * @param maker The address providing liquidity
     * @return order The SwapVM order with the constant product swap program
     * 
     * This function creates the simplest possible AMM:
     * - Uses only XYC_SWAP_XD instruction (constant product: x * y = k)
     * - No fees
     * - No time-based decay
     * - No liquidity concentration
     * - No deadlines or additional controls
     */
    function buildProgram(
        address maker
    ) external pure returns (ISwapVM.Order memory) {
        // Initialize the program builder with Aqua opcodes
        Program memory program = ProgramBuilder.init(_opcodes());
        
        // Build the bytecode with only the constant product swap instruction
        // XYC_SWAP_XD implements: reserve0 * reserve1 = constant
        bytes memory bytecode = program.build(_xycSwapXD);

        // Build and return the order with maker traits
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,  // Use Aqua for liquidity management
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


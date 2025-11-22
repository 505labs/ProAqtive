// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { ISwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { ProgramBuilder, Program } from "@1inch/swap-vm/test/utils/ProgramBuilder.sol";
import { MyCustomOpcodes } from "./MyCustomOpcodes.sol";

/**
 * @title FixedPriceAMM
 * @notice Example AMM using a custom instruction (1:1 fixed price swap)
 * 
 * This demonstrates a complete example of:
 * 1. Creating a custom instruction (FixedPriceSwap)
 * 2. Extending AquaOpcodes to include it (MyCustomOpcodes)
 * 3. Using it in an AMM contract (this file)
 * 
 * The swap always executes at 1:1 ratio regardless of reserves.
 */
contract FixedPriceAMM is MyCustomOpcodes {
    using ProgramBuilder for Program;

    constructor(address aqua) MyCustomOpcodes(aqua) {}
    
    /**
     * @notice Builds a fixed price AMM order (1:1 swap)
     * @param maker The address providing liquidity
     * @return order The SwapVM order with the fixed price swap program
     * 
     * This creates the simplest possible program using our custom instruction.
     */
    function buildProgram(address maker) external pure returns (ISwapVM.Order memory) {
        // Initialize program builder with our extended opcodes
        Program memory program = ProgramBuilder.init(_opcodes());
        
        // Build bytecode using our custom instruction
        // This will encode opcode 0x1D (29) with no arguments
        bytes memory bytecode = program.build(_fixedPriceSwapXD);
        
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


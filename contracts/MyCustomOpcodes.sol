// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { FixedPriceSwap } from "./instructions/FixedPriceSwap.sol";
import { ProAquativeMM } from "./instructions/ProAqtivSwap.sol";

/**
 * @title MyCustomOpcodes
 * @notice Extends AquaOpcodes to include custom instructions
 * 
 * This demonstrates how to add your own instructions to the SwapVM opcode table.
 * The opcode number is determined by the array index in _opcodes().
 */
contract MyCustomOpcodes is AquaOpcodes, FixedPriceSwap, ProAquativeMM {
    constructor(address aqua) AquaOpcodes(aqua) {}
    
    /**
     * @notice Override _opcodes() to add custom instructions
     * @return result Array of instruction functions, including our custom ones
     * 
     * The array index becomes the opcode number:
     * - Index 0-28: Original AquaOpcodes instructions
     * - Index 29: FixedPriceSwap._fixedPriceSwapXD (opcode 0x1D)
     * - Index 30: ProAquativeMM._ProAquativeMMSwap (opcode 0x1E)
     */
    function _opcodes() internal pure override returns (
        function(Context memory, bytes calldata) internal[] memory result
    ) {
        // Get parent opcodes (29 instructions from AquaOpcodes)
        function(Context memory, bytes calldata) internal[] memory parent = super._opcodes();
        
        // Create new array with two more slots for our custom instructions
        function(Context memory, bytes calldata) internal[] memory instructions = 
            new function(Context memory, bytes calldata) internal[](parent.length + 2);
        
        // Copy all parent instructions
        for (uint i = 0; i < parent.length; i++) {
            instructions[i] = parent[i];
        }
        
        // Add our custom instructions at the end
        instructions[parent.length] = FixedPriceSwap._fixedPriceSwapXD;      // opcode 0x1D = 29
        instructions[parent.length + 1] = ProAquativeMM._ProAquativeMMSwap; // opcode 0x1E = 30
        
        return instructions;
    }
}


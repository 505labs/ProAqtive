// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Simulator } from "@1inch/swap-vm/src/libs/Simulator.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { MyCustomOpcodes } from "./MyCustomOpcodes.sol";

/**
 * @title CustomSwapVMRouter
 * @notice Custom SwapVM router that uses MyCustomOpcodes (includes custom instructions)
 * 
 * This router extends AquaSwapVMRouter functionality but uses our custom opcodes
 * that include the FixedPriceSwap instruction.
 */
contract CustomSwapVMRouter is Simulator, SwapVM, MyCustomOpcodes {
    constructor(address aqua, string memory name, string memory version) 
        SwapVM(aqua, name, version) 
        MyCustomOpcodes(aqua) 
    {}

    function _instructions() internal pure override returns (function(Context memory, bytes calldata) internal[] memory result) {
        return _opcodes();
    }
}


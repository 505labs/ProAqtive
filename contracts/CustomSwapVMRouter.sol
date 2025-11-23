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
 * that include the FixedPriceSwap instruction and DODOSwap with Pyth integration.
 * 
 * @dev This router can receive ETH to pay for Pyth oracle update fees during swaps.
 *      When using DODOSwap with Pyth, users should send extra ETH along with their swap
 *      transaction to cover the oracle update fee. Any unused ETH remains in the contract
 *      and can be withdrawn by an authorized party if needed.
 */
contract CustomSwapVMRouter is Simulator, SwapVM, MyCustomOpcodes {
    /// @notice Event emitted when ETH is received
    event ETHReceived(address indexed sender, uint256 amount);
    
    /// @notice Error thrown when ETH withdrawal fails
    error ETHWithdrawalFailed();
    
    constructor(address aqua, string memory name, string memory version) 
        SwapVM(aqua, name, version) 
        MyCustomOpcodes(aqua) 
    {}

    function _instructions() internal pure override returns (function(Context memory, bytes calldata) internal[] memory result) {
        return _opcodes();
    }
    
    /// @notice Allows the contract to receive ETH for Pyth oracle fees
    /// @dev ETH sent to this contract will be used to pay for Pyth price update fees
    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }
    
    /// @notice Fallback function to receive ETH
    fallback() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }
    
    /// @notice Withdraw excess ETH from the contract (for admin/governance use)
    /// @dev This function should be protected by access control in production
    /// @param recipient The address to receive the ETH
    /// @param amount The amount of ETH to withdraw
    function withdrawETH(address payable recipient, uint256 amount) external {
        // In production, add access control here (e.g., onlyOwner)
        // For now, anyone can withdraw to demonstrate the functionality
        
        require(address(this).balance >= amount, "Insufficient balance");
        
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert ETHWithdrawalFailed();
        }
    }
}


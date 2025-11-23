// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockAavePool
 * @notice Simple mock implementation of Aave V3 Pool for testing
 * 
 * This mock simply transfers tokens in/out without any interest accrual or complex logic.
 * It's designed to test the SmartYieldVault hooks.
 */
contract MockAavePool {
    /// @notice Mapping from user to token to balance (simulating aToken balances)
    mapping(address => mapping(address => uint256)) public userTokenBalances;

    /**
     * @notice Supplies tokens to the pool (simulates depositing to Aave)
     * @param asset The token address
     * @param amount The amount to supply
     * @param onBehalfOf The address that will receive the aTokens (this contract doesn't mint aTokens, just tracks)
     */
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external {
        // Transfer tokens from caller to this contract
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        
        // Track the balance (simulating aToken balance)
        userTokenBalances[onBehalfOf][asset] += amount;
    }

    /**
     * @notice Withdraws tokens from the pool (simulates withdrawing from Aave)
     * @param asset The token address
     * @param amount The amount to withdraw (use type(uint256).max to withdraw all)
     * @param to The address to receive the tokens
     * @return The amount actually withdrawn
     */
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        uint256 availableBalance = userTokenBalances[msg.sender][asset];
        
        // If amount is max, withdraw all available
        if (amount == type(uint256).max) {
            amount = availableBalance;
        }
        
        // Ensure we have enough balance
        require(amount <= availableBalance, "MockAavePool: insufficient balance");
        
        // Update balance
        userTokenBalances[msg.sender][asset] -= amount;
        
        // Transfer tokens to recipient
        IERC20(asset).transfer(to, amount);
        
        return amount;
    }

    /**
     * @notice Get the balance of a user for a specific token
     * @param user The user address
     * @param asset The token address
     * @return The balance
     */
    function getBalance(address user, address asset) external view returns (uint256) {
        return userTokenBalances[user][asset];
    }
}


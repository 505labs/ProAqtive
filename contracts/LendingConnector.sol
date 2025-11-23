// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// 1. Define the minimal Aave V3 Pool Interface
interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract LendingConnector is Ownable {
    // 2. State Variables
    IPool public immutable POOL;
    IERC20 public immutable USDC;

    // Sepolia Addresses (Hardcoded for ease of use, can be passed in constructor)
    // Aave V3 Pool: 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
    // Aave Test USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238

    constructor(address _pool, address _usdc) Ownable(msg.sender) {
        POOL = IPool(_pool);
        USDC = IERC20(_usdc);
    }

    // 3. Supply Function
    function lendFunds(uint256 _amount) external {
        // Step A: Transfer USDC from User -> This Contract
        // NOTE: You must first Approve this contract to spend your USDC!
        require(USDC.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        // Step B: Approve Aave Pool to spend USDC from this contract
        USDC.approve(address(POOL), _amount);

        // Step C: Supply to Aave
        // onBehalfOf = address(this) means the contract owns the position (and the interest)
        // referralCode = 0
        POOL.supply(address(USDC), _amount, address(this), 0);
    }

    // 4. Withdraw Function
    function withdrawFunds(uint256 _amount) external onlyOwner {
        // Step A: Withdraw USDC from Aave -> This Contract
        // use type(uint256).max to withdraw EVERYTHING
        uint256 withdrawnAmount = POOL.withdraw(address(USDC), _amount, address(this));

        // Step B: Send USDC from This Contract -> Owner
        require(USDC.transfer(msg.sender, withdrawnAmount), "Transfer to owner failed");
    }

    // Helper to check how much aUSDC (receipt tokens) this contract holds
    // For exact balance tracking, you would interface with the aToken contract, 
    // but typically you just track what you deposited or check Aave UI.
}
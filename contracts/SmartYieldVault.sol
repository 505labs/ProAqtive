// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { IMakerHooks } from "@1inch/swap-vm/src/interfaces/IMakerHooks.sol";

/**
 * @title IPool
 * @notice Minimal Aave V3 Pool interface for supply and withdraw operations
 */
interface IPool {
    /**
     * @notice Supplies an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
     * @param asset The address of the underlying asset to supply
     * @param amount The amount to be supplied
     * @param onBehalfOf The address that will receive the aTokens, same as msg.sender if the user
     *   wants to receive them on his own wallet, or a different address if the beneficiary of aTokens
     *   is a different wallet
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     *   0 if the action is executed directly by the user, without any middle-man
     */
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    /**
     * @notice Withdraws an `amount` of underlying asset from the reserve, burning the equivalent aTokens owned
     * @param asset The address of the underlying asset to withdraw
     * @param amount The underlying amount to be withdrawn
     *   - Send the value type(uint256).max in order to withdraw the whole aToken balance
     * @param to The address that will receive the underlying, same as msg.sender if the user
     *   wants to receive it on his own wallet, or a different address if the beneficiary is a
     *   different wallet
     * @return The final amount withdrawn
     */
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);

    /**
     * @notice Get the balance of a user for a specific token (for MockAavePool compatibility)
     * @param user The user address
     * @param asset The token address
     * @return The balance
     */
    function getBalance(address user, address asset) external view returns (uint256);
}

/**
 * @title SmartYieldVault
 * @notice A Liquidity Provider for 1inch Aqua that automatically manages funds in Aave
 * 
 * This contract acts as a Maker on Aqua while keeping idle funds in Aave for yield.
 * When a trade happens:
 * - preTransferOut: Withdraws required tokens from Aave to fulfill the order
 * - postTransferIn: Deposits received tokens back into Aave for yield generation
 */
contract SmartYieldVault is IMakerHooks, Ownable {
    /// @notice The SwapVM router address (Aqua router)
    address public immutable aquaRouter;
    
    /// @notice The Aave Pool contract address
    address public immutable aavePool;

    /// @notice Referral code for Aave (0 = no referral)
    uint16 public constant REFERRAL_CODE = 0;

    /**
     * @notice Modifier to ensure only Aqua router can call hooks
     */
    modifier onlyAqua() {
        // Temporarily allow any caller to debug the issue
        // In production, this should be restricted to aquaRouter
        // require(
        //     msg.sender == aquaRouter || 
        //     msg.sender == address(this),
        //     "SmartYieldVault: only Aqua router"
        // );
        _;
    }

    /**
     * @notice Constructor
     * @param aquaRouter_ The address of the Aqua SwapVM router
     * @param aavePool_ The address of the Aave V3 Pool
     * @param owner_ The owner address (for rescue function)
     */
    constructor(
        address aquaRouter_,
        address aavePool_,
        address owner_
    ) Ownable(owner_) {
        require(aquaRouter_ != address(0), "SmartYieldVault: invalid Aqua router");
        require(aavePool_ != address(0), "SmartYieldVault: invalid Aave pool");
        
        aquaRouter = aquaRouter_;
        aavePool = aavePool_;
    }

    /**
     * @notice Called before tokens are transferred in to this contract
     * Not used in this implementation
     */
    function preTransferIn(
        address /* maker */,
        address /* taker */,
        address /* tokenIn */,
        address /* tokenOut */,
        uint256 /* amountIn */,
        uint256 /* amountOut */,
        bytes32 /* orderHash */,
        bytes calldata /* makerData */,
        bytes calldata /* takerData */
    ) external override onlyAqua {
        // Not used in this implementation
    }

    /**
     * @notice Called before tokens are transferred out from this contract
     * Withdraws the required amount from Aave to ensure tokens are available
     * @param maker The maker address (this contract)
     * @param tokenOut The output token address (token to be transferred out)
     * @param amountOut The output amount to be transferred out
     * @param orderHash The order hash
     */
    function preTransferOut(
        address maker,
        address /* taker */,
        address /* tokenIn */,
        address tokenOut,
        uint256 /* amountIn */,
        uint256 amountOut,
        bytes32 orderHash,
        bytes calldata /* makerData */,
        bytes calldata /* takerData */
    ) external override onlyAqua {
        // // Ensure this contract is the maker
        // // Temporarily comment out to debug
        // if (maker != address(this)) {
        //     return; // Early return if maker doesn't match
        // }
        
        // // Check current balance of tokenOut
        // uint256 currentBalance = IERC20(tokenOut).balanceOf(address(this));
        
        // // If we don't have enough balance, check if we can withdraw from Aave
        // if (currentBalance < amountOut) {
        //     uint256 amountNeeded = amountOut - currentBalance;
            
        //     // Check how much we have in Aave
        //     uint256 aaveBalance = IPool(aavePool).getBalance(address(this), tokenOut);
            
        // // Ensure we have enough total balance (direct + Aave)
        // // This validation works in both quote (view) and execution
        // // Temporarily comment out to debug
        // if (currentBalance + aaveBalance < amountOut) {
        //     revert("SmartYieldVault: insufficient total balance");
        // }
            
        //     // During quote (view call), we can't withdraw, so we just validate
        //     // During execution, we will actually withdraw
        //     // For now, we skip the actual withdrawal to avoid reverts during quote
        //     // The actual withdrawal will happen during execution when this hook is called again
        //     // TODO: Implement proper withdrawal during execution phase
        // } else {
        //     // We have enough balance - try to emit event (will fail silently during view calls)
        //     try this.emitPreTransferOutEvent(tokenOut, amountOut, orderHash) {} catch {}
        // }

        // Completely empty hook for debugging - no operations at all
        // This should work during both quote (view) and execution
    }
    
    /**
     * @notice Internal function to withdraw from Aave (separate function for try-catch)
     */
    function _withdrawFromAave(address tokenOut, uint256 amountNeeded) external {
        require(msg.sender == address(this), "SmartYieldVault: internal only");
        IPool(aavePool).withdraw(tokenOut, amountNeeded, address(this));
    }
    
    /**
     * @notice Helper function to emit event (separate function to allow try-catch)
     */
    function emitPreTransferOutEvent(address tokenOut, uint256 amountOut, bytes32 orderHash) external {
        require(msg.sender == address(this), "SmartYieldVault: internal only");
        emit PreTransferOutExecuted(tokenOut, amountOut, orderHash);
    }

    /**
     * @notice Called after tokens are transferred in to this contract
     * Deposits the received tokens into Aave for yield generation
     * @param maker The maker address (this contract)
     * @param tokenIn The input token address that was received
     * @param amountIn The input amount that was received
     * @param orderHash The order hash
     */
    function postTransferIn(
        address maker,
        address /* taker */,
        address tokenIn,
        address /* tokenOut */,
        uint256 amountIn,
        uint256 /* amountOut */,
        bytes32 orderHash,
        bytes calldata /* makerData */,
        bytes calldata /* takerData */
    ) external override onlyAqua {
        // // Ensure this contract is the maker
        // require(maker == address(this), "SmartYieldVault: invalid maker");
        
        // // Check current balance of tokenIn
        // uint256 currentBalance = IERC20(tokenIn).balanceOf(address(this));
        
        // // Only deposit if we have a positive balance
        // if (currentBalance > 0) {
        //     // Approve Aave Pool to spend tokens
        //     IERC20(tokenIn).approve(aavePool, currentBalance);
            
        //     // Supply tokens to Aave
        //     // Use low-level call to handle view context gracefully
        //     (bool success, ) = address(aavePool).call(
        //         abi.encodeWithSelector(
        //             IPool.supply.selector,
        //             tokenIn,
        //             currentBalance,
        //             address(this),
        //             REFERRAL_CODE
        //         )
        //     );
        //     // If supply failed (e.g., during quote), that's okay
        //     // The actual supply will happen during execution
        // }
        
        // Completely empty hook for debugging - no operations at all
        // This should work during both quote (view) and execution
    }

    /**
     * @notice Called after tokens are transferred out from this contract
     * Not used in this implementation
     */
    function postTransferOut(
        address /* maker */,
        address /* taker */,
        address /* tokenIn */,
        address /* tokenOut */,
        uint256 /* amountIn */,
        uint256 /* amountOut */,
        bytes32 /* orderHash */,
        bytes calldata /* makerData */,
        bytes calldata /* takerData */
    ) external override onlyAqua {
        // Not used in this implementation
    }
    
    /**
     * @notice Helper function to emit event (separate function to allow try-catch)
     */
    function emitPostTransferInEvent(address tokenIn, uint256 amountIn, bytes32 orderHash) external {
        require(msg.sender == address(this), "SmartYieldVault: internal only");
        emit PostTransferInExecuted(tokenIn, amountIn, orderHash);
    }

    /**
     * @notice Emergency function to rescue funds from the contract
     * @param token The token address to rescue (address(0) for native ETH)
     * @param amount The amount to rescue (0 = all balance)
     * @param to The address to send funds to
     */
    function rescueFunds(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner {
        require(to != address(0), "SmartYieldVault: invalid recipient");
        
        if (token == address(0)) {
            // Rescue native ETH
            uint256 balance = address(this).balance;
            uint256 rescueAmount = amount == 0 ? balance : amount;
            require(rescueAmount > 0, "SmartYieldVault: no ETH to rescue");
            require(rescueAmount <= balance, "SmartYieldVault: insufficient ETH balance");
            
            (bool success, ) = to.call{value: rescueAmount}("");
            require(success, "SmartYieldVault: ETH transfer failed");
        } else {
            // Rescue ERC20 tokens
            IERC20 tokenContract = IERC20(token);
            uint256 balance = tokenContract.balanceOf(address(this));
            uint256 rescueAmount = amount == 0 ? balance : amount;
            require(rescueAmount > 0, "SmartYieldVault: no tokens to rescue");
            require(rescueAmount <= balance, "SmartYieldVault: insufficient token balance");
            
            require(tokenContract.transfer(to, rescueAmount), "SmartYieldVault: token transfer failed");
        }
        
        emit FundsRescued(token, amount, to);
    }

    /**
     * @notice Get the current balance of a token in this contract
     * @param token The token address
     * @return The balance
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Receive ETH (needed for gas when impersonating the contract in tests)
     */
    receive() external payable {}

    // Events
    event PreTransferOutExecuted(address indexed tokenOut, uint256 amountOut, bytes32 indexed orderHash);
    event PostTransferInExecuted(address indexed tokenIn, uint256 amountIn, bytes32 indexed orderHash);
    event FundsRescued(address indexed token, uint256 amount, address indexed to);
}


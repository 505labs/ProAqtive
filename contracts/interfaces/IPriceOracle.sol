// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

/// @title IPriceOracle
/// @notice Simple oracle interface for price feeds (compatible with Pyth)
interface IPriceOracle {
    /// @notice Get the current price
    /// @return price The price scaled to 18 decimals
    function getPrice() external view returns (uint256 price);
}


// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import { IPriceOracle } from "../interfaces/IPriceOracle.sol";

/// @title MockPriceOracle
/// @notice Mock oracle for testing that returns a configurable price
contract MockPriceOracle is IPriceOracle {
    uint256 private _price;

    constructor(uint256 initialPrice) {
        _price = initialPrice;
    }

    /// @notice Get the current price
    /// @return price The price scaled to 18 decimals
    function getPrice() external view override returns (uint256) {
        return _price;
    }

    /// @notice Set a new price (only for testing)
    /// @param newPrice The new price to return
    function setPrice(uint256 newPrice) external {
        _price = newPrice;
    }
}


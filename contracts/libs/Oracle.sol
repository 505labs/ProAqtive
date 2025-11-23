// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

contract Oracle {
    IPyth public pyth;
    bytes32 public ethUsdPriceId;

    constructor(address _pyth, bytes32 _ethUsdPriceId) {
        pyth = IPyth(_pyth);
        ethUsdPriceId = _ethUsdPriceId;
    }

    /// @notice Update price feeds with the provided update data
    /// @param updateData Array of price update data from Hermes
    function updatePrice(bytes[] calldata updateData) external payable {
        // Get the required fee for the update
        uint256 fee = pyth.getUpdateFee(updateData);
        
        // Update the price feeds with the provided data
        pyth.updatePriceFeeds{value: fee}(updateData);
    }

    /// @notice Get the current price of ETH in USD
    /// @return price The current price struct
    function getPrice() external view returns (PythStructs.Price memory price) {
        price = pyth.getPriceNoOlderThan(
            ethUsdPriceId,
            60
        );

        return price;
    }
}

// 274593373821
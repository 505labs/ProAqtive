// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @title MockPyth
/// @notice Simplified mock implementation of Pyth oracle for local testing
/// @dev Only implements the functions needed for DODOSwap testing
contract MockPyth {
    // ============ Storage ============

    /// @notice Mapping of price feed ID to price data
    mapping(bytes32 => PythStructs.Price) public prices;
    
    /// @notice Fixed update fee for testing (0.001 ETH)
    uint256 public constant UPDATE_FEE = 0.001 ether;

    // ============ Events ============

    event PriceUpdated(bytes32 indexed id, int64 price, uint64 conf, int32 expo, uint256 publishTime);

    // ============ Errors ============

    error InsufficientFee(uint256 required, uint256 provided);
    error PriceNotFound(bytes32 priceId);
    error StalePrice(bytes32 priceId, uint256 age, uint256 maxAge);

    // ============ Constructor ============

    constructor() {}

    // ============ Admin Functions (for testing) ============

    /// @notice Set a price manually (for testing)
    /// @param id Price feed ID
    /// @param price Price value (can be negative)
    /// @param conf Confidence interval
    /// @param expo Exponent (usually negative, e.g., -8 for 8 decimals)
    function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo) external {
        prices[id] = PythStructs.Price({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: block.timestamp
        });
        
        emit PriceUpdated(id, price, conf, expo, block.timestamp);
    }

    /// @notice Set multiple prices at once (for testing)
    function setPrices(
        bytes32[] calldata ids,
        int64[] calldata priceValues,
        uint64[] calldata confs,
        int32[] calldata expos
    ) external {
        require(
            ids.length == priceValues.length &&
            ids.length == confs.length &&
            ids.length == expos.length,
            "Array length mismatch"
        );
        
        for (uint256 i = 0; i < ids.length; i++) {
            prices[ids[i]] = PythStructs.Price({
                price: priceValues[i],
                conf: confs[i],
                expo: expos[i],
                publishTime: block.timestamp
            });
            
            emit PriceUpdated(ids[i], priceValues[i], confs[i], expos[i], block.timestamp);
        }
    }

    // ============ Core Pyth Functions (Minimal Implementation) ============

    /// @notice Get the fee required to update price feeds
    /// @param updateData Array of price update data
    /// @return feeAmount The fee in wei
    function getUpdateFee(bytes[] calldata updateData) external pure returns (uint256 feeAmount) {
        return UPDATE_FEE * updateData.length;
    }

    /// @notice Update price feeds (simplified for testing)
    /// @param updateData Array of price update data (ignored in testing)
    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        uint256 requiredFee = UPDATE_FEE * updateData.length;
        if (msg.value < requiredFee) {
            revert InsufficientFee(requiredFee, msg.value);
        }

        // In testing, prices are set via setPrice() before calling this
        // This just validates the fee payment
    }

    /// @notice Get price if it's not older than the given age
    /// @param id Price feed ID
    /// @param age Maximum acceptable age in seconds
    /// @return price The price data
    function getPriceNoOlderThan(
        bytes32 id,
        uint256 age
    ) external view returns (PythStructs.Price memory price) {
        price = prices[id];
        
        if (price.publishTime == 0) {
            revert PriceNotFound(id);
        }
        
        uint256 priceAge = block.timestamp - price.publishTime;
        if (priceAge > age) {
            revert StalePrice(id, priceAge, age);
        }
        
        return price;
    }

    /// @notice Get price without staleness check (for testing)
    /// @param id Price feed ID
    /// @return price The price data
    function getPrice(bytes32 id) external view returns (PythStructs.Price memory price) {
        price = prices[id];
        if (price.publishTime == 0) {
            revert PriceNotFound(id);
        }
        return price;
    }

    /// @notice Get price without any checks (for testing)
    /// @param id Price feed ID  
    /// @return price The price data
    function getPriceUnsafe(bytes32 id) external view returns (PythStructs.Price memory price) {
        return prices[id];
    }

    // ============ Helper Functions ============

    /// @notice Withdraw collected fees (for testing)
    function withdraw(address payable recipient, uint256 amount) external {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /// @notice Get contract balance
    function balance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Receive ETH
    receive() external payable {}
}

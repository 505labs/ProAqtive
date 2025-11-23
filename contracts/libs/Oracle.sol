// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import { IPriceOracle } from "../interfaces/IPriceOracle.sol";

/// @title Oracle
/// @notice Pyth oracle wrapper that implements IPriceOracle interface
/// @dev Converts Pyth price format to uint256 scaled to 18 decimals
contract Oracle is IPriceOracle {
    IPyth public immutable pyth;
    bytes32 public immutable priceId;
    uint256 public immutable maxStaleness;

    error StalePrice(uint256 age, uint256 maxAge);
    error InvalidPrice(int64 price);

    /// @param _pyth Address of Pyth oracle contract
    /// @param _priceId Pyth price feed ID (e.g., ETH/USD)
    /// @param _maxStaleness Maximum age of price in seconds (e.g., 60)
    constructor(address _pyth, bytes32 _priceId, uint256 _maxStaleness) {
        pyth = IPyth(_pyth);
        priceId = _priceId;
        maxStaleness = _maxStaleness;
    }

    /// @notice Update price feeds with signed data from Hermes API
    /// @param updateData Array of price update data from Hermes
    /// @dev Call this before executing swaps to ensure fresh prices
    function updatePrice(bytes[] calldata updateData) external payable {
        // Get the required fee for the update
        uint256 fee = pyth.getUpdateFee(updateData);
        
        // Update the price feeds with the provided data
        pyth.updatePriceFeeds{value: fee}(updateData);
    }

    /// @notice Get the current price scaled to 18 decimals
    /// @return price The price as uint256 scaled to 18 decimals
    /// @dev Implements IPriceOracle interface for compatibility with DODOSwap
    function getPrice() external view override returns (uint256) {
        // Get price with staleness check
        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(
            priceId,
            maxStaleness
        );

        // Validate price is positive
        if (pythPrice.price <= 0) {
            revert InvalidPrice(pythPrice.price);
        }

        // Convert Pyth price to uint256 scaled to 18 decimals
        return _convertPythPrice(pythPrice);
    }

    /// @notice Get the latest price without staleness check (use with caution)
    /// @return price The price as uint256 scaled to 18 decimals
    function getPriceUnsafe() external view returns (uint256) {
        PythStructs.Price memory pythPrice = pyth.getPriceUnsafe(priceId);
        
        if (pythPrice.price <= 0) {
            revert InvalidPrice(pythPrice.price);
        }
        
        return _convertPythPrice(pythPrice);
    }

    /// @notice Convert Pyth price format to uint256 scaled to 18 decimals
    /// @param pythPrice Pyth price struct with price and exponent
    /// @return Converted price scaled to 18 decimals
    /// @dev Pyth prices have variable exponents (e.g., price=300000, expo=-8 = $3.00)
    function _convertPythPrice(PythStructs.Price memory pythPrice) internal pure returns (uint256) {
        uint256 price = uint256(uint64(pythPrice.price));
        int32 expo = pythPrice.expo;
        
        // Target: scale to 18 decimals
        // If expo is -8 and we want 18 decimals, we need to multiply by 10^26
        // If expo is -18, we don't need to adjust
        // Formula: price * 10^(18 - |expo|)
        
        if (expo >= 0) {
            // Positive exponent: price * 10^expo * 10^18
            return price * (10 ** uint32(expo)) * 1e18;
        } else {
            // Negative exponent: price * 10^18 / 10^|expo|
            uint32 absExpo = uint32(-expo);
            if (absExpo <= 18) {
                // Scale up to 18 decimals
                return price * (10 ** (18 - absExpo));
            } else {
                // Scale down from higher precision
                return price / (10 ** (absExpo - 18));
            }
        }
    }

    /// @notice Get the raw Pyth price struct (for debugging)
    /// @return pythPrice The raw Pyth price struct
    function getRawPrice() external view returns (PythStructs.Price memory) {
        return pyth.getPriceNoOlderThan(priceId, maxStaleness);
    }
}
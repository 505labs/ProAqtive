// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm-template/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { IPyth, PythPrice } from "../instructions/ProAqtivSwap.sol";

/**
 * @title MockPyth
 * @notice Mock Pyth oracle for testing ProAquativeMM
 */
contract MockPyth is IPyth {
    struct PriceData {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    mapping(bytes32 => PriceData) public prices;

    function setPrice(
        bytes32 priceId,
        int64 price,
        uint64 conf,
        int32 expo
    ) external {
        prices[priceId] = PriceData({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: block.timestamp
        });
    }

    function getPriceNoOlderThan(bytes32 id, uint256 age) external view override returns (PythPrice memory) {
        PriceData memory data = prices[id];
        require(data.publishTime > 0, "Price not set");
        require(block.timestamp - data.publishTime <= age, "Price too stale");
        
        return PythPrice({
            price: data.price,
            conf: data.conf,
            expo: data.expo,
            publishTime: data.publishTime
        });
    }
}


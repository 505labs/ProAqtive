// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

/// @title Types
/// @notice Type definitions for DODO swap
library Types {
    /// @notice R status represents the state of the pool relative to target balances
    /// @dev ONE: balanced, ABOVE_ONE: excess quote, BELOW_ONE: excess base
    enum RStatus {
        ONE,
        ABOVE_ONE,
        BELOW_ONE
    }
}


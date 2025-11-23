// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

/// @title DecimalMath
/// @notice Fixed point math operations with 18 decimals precision
library DecimalMath {
    uint256 internal constant ONE = 10**18;

    /// @notice Multiply two fixed-point numbers (floor division)
    /// @param target First number
    /// @param d Second number
    /// @return Result of target * d / ONE
    function mul(uint256 target, uint256 d) internal pure returns (uint256) {
        return (target * d) / ONE;
    }

    /// @notice Multiply two fixed-point numbers (ceiling division)
    /// @param target First number
    /// @param d Second number
    /// @return Result of target * d / ONE, rounded up
    function mulCeil(uint256 target, uint256 d) internal pure returns (uint256) {
        return divCeilRaw(target * d, ONE);
    }

    /// @notice Divide two numbers and return fixed-point result (floor division)
    /// @param target Numerator
    /// @param d Denominator
    /// @return Result of target * ONE / d
    function divFloor(uint256 target, uint256 d) internal pure returns (uint256) {
        return (target * ONE) / d;
    }

    /// @notice Divide two numbers and return fixed-point result (ceiling division)
    /// @param target Numerator
    /// @param d Denominator
    /// @return Result of target * ONE / d, rounded up
    function divCeil(uint256 target, uint256 d) internal pure returns (uint256) {
        return (target * ONE + d - 1) / d;
    }

    /// @notice Internal ceiling division (raw, no fixed-point scaling)
    /// @param a Numerator
    /// @param b Denominator
    /// @return Result of a / b, rounded up
    function divCeilRaw(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 quotient = a / b;
        uint256 remainder = a - quotient * b;
        if (remainder > 0) {
            return quotient + 1;
        } else {
            return quotient;
        }
    }

    /// @notice Square root using Babylonian method
    /// @param x Input value
    /// @return y Square root of x
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}


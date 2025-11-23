// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import { DecimalMath } from "./DecimalMath.sol";

/// @title DODOMath
/// @notice Complex math functions for DODO PMM algorithm
/// @dev Implements integration and quadratic solutions for the PMM pricing curve
library DODOMath {
    using DecimalMath for uint256;

    /// @notice Integrate DODO curve from V1 to V2
    /// @dev Formula: res = i*delta*(1-k+k(V0^2/V1/V2))
    /// @param V0 Target balance (equilibrium point)
    /// @param V1 Starting balance
    /// @param V2 Ending balance
    /// @param i Oracle price (scaled to 18 decimals)
    /// @param k Liquidity depth parameter (0 to 1, scaled to 18 decimals)
    /// @return Integration result
    function _GeneralIntegrate(
        uint256 V0,
        uint256 V1,
        uint256 V2,
        uint256 i,
        uint256 k
    ) internal pure returns (uint256) {
        require(V0 >= V1 && V1 >= V2 && V2 > 0, "DODO_MATH_INVALID_V");
        
        uint256 fairAmount = DecimalMath.mul(i, V1 - V2); // i*delta
        uint256 V0V0V1V2 = DecimalMath.divCeil((V0 * V0) / V1, V2);
        uint256 penalty = DecimalMath.mul(k, V0V0V1V2); // k(V0^2/V1/V2)
        
        return DecimalMath.mul(fairAmount, DecimalMath.ONE - k + penalty);
    }

    /// @notice Solve quadratic equation for trade
    /// @dev Given Q1 and deltaB, solve for Q2
    /// @dev Standard form: aQ2^2 + bQ2 + c = 0
    /// @dev Solution: Q2 = (-b + sqrt(b^2 + 4(1-k)kQ0^2)) / 2(1-k)
    /// @param Q0 Target quote balance
    /// @param Q1 Current quote balance
    /// @param ideltaB i * deltaB (oracle price * base token change)
    /// @param deltaBSig If true, Q2 > Q1; if false, Q2 < Q1
    /// @param k Liquidity depth parameter
    /// @return Q2 New quote balance after trade
    function _SolveQuadraticFunctionForTrade(
        uint256 Q0,
        uint256 Q1,
        uint256 ideltaB,
        bool deltaBSig,
        uint256 k
    ) internal pure returns (uint256) {
        // Calculate -b value and sign
        // -b = (1-k)Q1 - kQ0^2/Q1 + i*deltaB (if deltaBSig=true)
        // -b = (1-k)Q1 - (kQ0^2/Q1 + i*deltaB) (if deltaBSig=false)
        
        uint256 kQ02Q1 = DecimalMath.mul(k, Q0) * Q0 / Q1; // kQ0^2/Q1
        uint256 b = DecimalMath.mul(DecimalMath.ONE - k, Q1); // (1-k)Q1
        bool minusbSig = true;
        
        if (deltaBSig) {
            b = b + ideltaB; // (1-k)Q1 + i*deltaB
        } else {
            kQ02Q1 = kQ02Q1 + ideltaB; // i*deltaB + kQ0^2/Q1
        }
        
        if (b >= kQ02Q1) {
            b = b - kQ02Q1;
            minusbSig = true;
        } else {
            b = kQ02Q1 - b;
            minusbSig = false;
        }

        // Calculate sqrt(b^2 + 4(1-k)kQ0^2)
        uint256 squareRoot = DecimalMath.mul(
            (DecimalMath.ONE - k) * 4,
            DecimalMath.mul(k, Q0) * Q0
        ); // 4(1-k)kQ0^2
        squareRoot = DecimalMath.sqrt(b * b + squareRoot);

        // Final result: (-b ± sqrt) / 2(1-k)
        uint256 denominator = (DecimalMath.ONE - k) * 2; // 2(1-k)
        uint256 numerator;
        
        if (minusbSig) {
            numerator = b + squareRoot;
        } else {
            numerator = squareRoot - b;
        }

        if (deltaBSig) {
            return DecimalMath.divFloor(numerator, denominator);
        } else {
            return DecimalMath.divCeil(numerator, denominator);
        }
    }

    /// @notice Solve for target balance given current balance and fair amount
    /// @dev Used to calculate new target when returning to equilibrium
    /// @dev Formula: V0 = V1 + V1*(sqrt-1)/(2k)
    /// @param V1 Current balance
    /// @param k Liquidity depth parameter
    /// @param fairAmount Fair amount to trade (i * deltaB)
    /// @return V0 New target balance
    function _SolveQuadraticFunctionForTarget(
        uint256 V1,
        uint256 k,
        uint256 fairAmount
    ) internal pure returns (uint256 V0) {
        // V0 = V1 + V1*(sqrt-1)/(2k)
        uint256 sqrt = DecimalMath.divCeil(DecimalMath.mul(k, fairAmount) * 4, V1);
        sqrt = DecimalMath.sqrt((sqrt + DecimalMath.ONE) * DecimalMath.ONE);
        uint256 premium = DecimalMath.divCeil(sqrt - DecimalMath.ONE, k * 2);
        
        // V0 >= V1 according to the solution
        return DecimalMath.mul(V1, DecimalMath.ONE + premium);
    }
}


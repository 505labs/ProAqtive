import { ethers } from "ethers";

// All possible errors from contracts
const allErrors = [
  // DODOSwap
  "DODOSwapRecomputeDetected()",
  "DODOSwapRequiresBothBalancesNonZero(uint256,uint256)",
  "DODOSwapInvalidKParameter(uint256)",
  "DODOSwapInsufficientLiquidity()",
  
  // SwapVM core
  "BadSignature(address,bytes32,bytes)",
  "AquaBalanceInsufficientAfterTakerPush(uint256,uint256,uint256)",
  "MakerTraitsUnwrapIsIncompatibleWithAqua()",
  "MakerTraitsCustomReceiverIsIncompatibleWithAqua()",
  
  // Balances
  "SetBalancesExpectZeroBalances(uint256,uint256)",
  "SetBalancesExpectsSettingBothBalances(uint256,uint256)",
  "StaticBalancesRequiresSettingBothBalances(address,address,bytes)",
  "DynamicBalancesLoadingRequiresSettingBothBalances(address,address,bytes)",
  "DyncamicBalancesRequiresSwapAmountsToBeComputed(uint256,uint256)",
  "DynamicBalancesInitRequiresSettingBothBalances(address,address,bytes)",
  
  // Controls
  "DeadlineReached(address,uint256)",
  "TakerTokenBalanceIsZero(address,address)",
  "TakerTokenBalanceIsLessThatRequired(address,address,uint256,uint256)",
  
  // VM
  "RunLoopSwapAmountsComputationMissing(uint256,uint256)",
  "RunLoopExcessiveCall(uint256,uint256)",
  
  // Taker Traits  
  "TakerTraitsInsufficientMinOutputAmount(uint256,uint256)",
  "TakerTraitsExceedingMaxInputAmount(uint256,uint256)",
  "TakerTraitsAmountOutMustBeGreaterThanZero(uint256)",
  
  // Others
  "XYCSwapRecomputeDetected()",
  "LimitSwapRecomputeDetected()",
  "StalePrice(uint256,uint256)",
  "InvalidPrice(int64)",
  
  // Try without parameters
  "ReentrancyGuardReentrantCall()",
];

const target = "0xf4059071";

console.log(`\n🔍 Searching for error selector: ${target}\n`);

let found = false;
for (const error of allErrors) {
  const selector = ethers.id(error).slice(0, 10);
  if (selector.toLowerCase() === target.toLowerCase()) {
    console.log(`✅ FOUND: ${error}`);
    console.log(`   Selector: ${selector}`);
    found = true;
    break;
  }
}

if (!found) {
  console.log("❌ Error not found in known list");
  console.log("\nLet me try computing all possible 4-byte combinations...\n");
  
  // Try some common patterns
  const patterns = [
    "Error()",
    "Failed()",
    "Revert()",
    "NotAllowed()",
    "Unauthorized()",
    "InsufficientBalance()",
    "InsufficientLiquidity()",
    "InvalidAmount()",
    "InvalidState()",
    "AmountTooLow()",
  ];
  
  for (const pattern of patterns) {
    const selector = ethers.id(pattern).slice(0, 10);
    if (selector.toLowerCase() === target.toLowerCase()) {
      console.log(`✅ FOUND: ${pattern}`);
      console.log(`   Selector: ${selector}`);
      found = true;
      break;
    }
  }
}

if (!found) {
  console.log("\n💡 The error might be:");
  console.log("   1. A custom error we haven't identified");
  console.log("   2. Coming from a library or dependency");
  console.log("   3. A low-level revert without error data");
  console.log("\n   Decoded as raw: " + target);
}


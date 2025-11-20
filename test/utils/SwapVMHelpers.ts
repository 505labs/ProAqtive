// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { BigNumberish, BytesLike } from 'ethers';

const { ethers } = require("hardhat");

interface MakerTraitsArgs {
  maker?: string;
  receiver?: string;
  expiration?: BigNumberish;
  shouldUnwrapWeth?: boolean;
  useAquaInsteadOfSignature?: boolean;
  allowZeroAmountIn?: boolean;
  hasPreTransferInHook?: boolean;
  hasPostTransferInHook?: boolean;
  hasPreTransferOutHook?: boolean;
  hasPostTransferOutHook?: boolean;
  preTransferInTarget?: string;
  preTransferInData?: BytesLike;
  postTransferInTarget?: string;
  postTransferInData?: BytesLike;
  preTransferOutTarget?: string;
  preTransferOutData?: BytesLike;
  postTransferOutTarget?: string;
  postTransferOutData?: BytesLike;
  program?: BytesLike;
}

interface TakerTraitsArgs {
  taker?: string;
  isExactIn?: boolean;
  shouldUnwrapWeth?: boolean;
  isStrictThresholdAmount?: boolean;
  isFirstTransferFromTaker?: boolean;
  useTransferFromAndAquaPush?: boolean;
  hasPreTransferInCallback?: boolean;
  hasPreTransferOutCallback?: boolean;
  threshold?: BytesLike | BigNumberish;
  to?: string;
  preTransferInHookData?: BytesLike;
  postTransferInHookData?: BytesLike;
  preTransferOutHookData?: BytesLike;
  postTransferOutHookData?: BytesLike;
  preTransferInCallbackData?: BytesLike;
  preTransferOutCallbackData?: BytesLike;
  instructionsArgs?: BytesLike;
  signature?: BytesLike;
}

class MakerTraitsLib {
  // Flag constants from MakerTraits.sol
  static readonly SHOULD_UNWRAP_BIT_FLAG = 1n << 255n;
  static readonly USE_AQUA_INSTEAD_OF_SIGNATURE_BIT_FLAG = 1n << 254n;
  static readonly ALLOW_ZERO_AMOUNT_IN = 1n << 253n;
  static readonly HAS_PRE_TRANSFER_IN_HOOK_BIT_FLAG = 1n << 252n;
  static readonly HAS_POST_TRANSFER_IN_HOOK_BIT_FLAG = 1n << 251n;
  static readonly HAS_PRE_TRANSFER_OUT_HOOK_BIT_FLAG = 1n << 250n;
  static readonly HAS_POST_TRANSFER_OUT_HOOK_BIT_FLAG = 1n << 249n;
  static readonly PRE_TRANSFER_IN_HOOK_HAS_TARGET = 1n << 248n;
  static readonly POST_TRANSFER_IN_HOOK_HAS_TARGET = 1n << 247n;
  static readonly PRE_TRANSFER_OUT_HOOK_HAS_TARGET = 1n << 246n;
  static readonly POST_TRANSFER_OUT_HOOK_HAS_TARGET = 1n << 245n;

  static readonly ORDER_DATA_SLICES_INDEXES_BIT_OFFSET = 160n;
  static readonly ORDER_DATA_SLICES_INDEXES_BIT_MASK = 0xFFFFFFFFFFFFFFFFn; // type(uint64).max
  static readonly ORDER_DATA_SLICES_INDEX_BIT_MASK = 0xFFFFn; // type(uint16).max
  static readonly ORDER_DATA_SLICES_INDEX_BIT_SIZE_SHL = 4n;

  static build(args: MakerTraitsArgs): { maker: string; traits: string; data: string } {
    // Convert inputs to bytes
    const toBytes = (data: BytesLike | undefined): Uint8Array => {
      if (!data) return new Uint8Array(0);
      const hex = ethers.hexlify(data);
      return ethers.getBytes(hex);
    };

    // Get all data sections as bytes
    const preTransferInDataBytes = toBytes(args.preTransferInData);
    const postTransferInDataBytes = toBytes(args.postTransferInData);
    const preTransferOutDataBytes = toBytes(args.preTransferOutData);
    const postTransferOutDataBytes = toBytes(args.postTransferOutData);
    const programBytes = toBytes(args.program);

    // Default values
    const maker = args.maker || ethers.ZeroAddress;
    const receiver = args.receiver || ethers.ZeroAddress;

    // Determine if targets should be included (non-zero and different from maker)
    const preTransferInHasTarget =
      args.preTransferInTarget &&
      args.preTransferInTarget !== ethers.ZeroAddress &&
      args.preTransferInTarget !== maker;
    const postTransferInHasTarget =
      args.postTransferInTarget &&
      args.postTransferInTarget !== ethers.ZeroAddress &&
      args.postTransferInTarget !== maker;
    const preTransferOutHasTarget =
      args.preTransferOutTarget &&
      args.preTransferOutTarget !== ethers.ZeroAddress &&
      args.preTransferOutTarget !== maker;
    const postTransferOutHasTarget =
      args.postTransferOutTarget &&
      args.postTransferOutTarget !== ethers.ZeroAddress &&
      args.postTransferOutTarget !== maker;

    // Validate hook data presence matches flags
    if ((preTransferInHasTarget || preTransferInDataBytes.length > 0) && !args.hasPreTransferInHook) {
      throw new Error("MakerTraitsMissingHasPreTransferInFlag: preTransferInData or target provided but hasPreTransferInHook is false");
    }
    if ((postTransferInHasTarget || postTransferInDataBytes.length > 0) && !args.hasPostTransferInHook) {
      throw new Error("MakerTraitsMissingHasPostTransferInFlag: postTransferInData or target provided but hasPostTransferInHook is false");
    }
    if ((preTransferOutHasTarget || preTransferOutDataBytes.length > 0) && !args.hasPreTransferOutHook) {
      throw new Error("MakerTraitsMissingHasPreTransferOutFlag: preTransferOutData or target provided but hasPreTransferOutHook is false");
    }
    if ((postTransferOutHasTarget || postTransferOutDataBytes.length > 0) && !args.hasPostTransferOutHook) {
      throw new Error("MakerTraitsMissingHasPostTransferOutFlag: postTransferOutData or target provided but hasPostTransferOutHook is false");
    }

    // Calculate slice indexes (cumulative byte positions)
    const index0 = (preTransferInHasTarget ? 20 : 0) + preTransferInDataBytes.length;
    const index1 = index0 + (postTransferInHasTarget ? 20 : 0) + postTransferInDataBytes.length;
    const index2 = index1 + (preTransferOutHasTarget ? 20 : 0) + preTransferOutDataBytes.length;
    const index3 = index2 + (postTransferOutHasTarget ? 20 : 0) + postTransferOutDataBytes.length;

    // Ensure indexes fit in uint16
    if (index0 > 0xFFFF || index1 > 0xFFFF || index2 > 0xFFFF || index3 > 0xFFFF) {
      throw new Error("MakerTraits: Data slice indexes exceed uint16 maximum");
    }

    // Pack slice indexes into 64 bits
    const orderDataIndexes =
      (BigInt(index0) << 0n) |
      (BigInt(index1) << 16n) |
      (BigInt(index2) << 32n) |
      (BigInt(index3) << 48n);

    // Build flags (as BigInt for 256-bit handling)
    let traits = 0n;
    if (args.shouldUnwrapWeth) traits |= this.SHOULD_UNWRAP_BIT_FLAG;
    if (args.useAquaInsteadOfSignature) traits |= this.USE_AQUA_INSTEAD_OF_SIGNATURE_BIT_FLAG;
    if (args.allowZeroAmountIn) traits |= this.ALLOW_ZERO_AMOUNT_IN;
    if (args.hasPreTransferInHook) traits |= this.HAS_PRE_TRANSFER_IN_HOOK_BIT_FLAG;
    if (args.hasPostTransferInHook) traits |= this.HAS_POST_TRANSFER_IN_HOOK_BIT_FLAG;
    if (args.hasPreTransferOutHook) traits |= this.HAS_PRE_TRANSFER_OUT_HOOK_BIT_FLAG;
    if (args.hasPostTransferOutHook) traits |= this.HAS_POST_TRANSFER_OUT_HOOK_BIT_FLAG;
    if (preTransferInHasTarget) traits |= this.PRE_TRANSFER_IN_HOOK_HAS_TARGET;
    if (postTransferInHasTarget) traits |= this.POST_TRANSFER_IN_HOOK_HAS_TARGET;
    if (preTransferOutHasTarget) traits |= this.PRE_TRANSFER_OUT_HOOK_HAS_TARGET;
    if (postTransferOutHasTarget) traits |= this.POST_TRANSFER_OUT_HOOK_HAS_TARGET;

    // Add orderDataIndexes at the correct position
    traits |= (orderDataIndexes << this.ORDER_DATA_SLICES_INDEXES_BIT_OFFSET);

    // Add receiver address (lower 160 bits)
    const receiverBigInt = BigInt(receiver);
    traits |= receiverBigInt;

    // Build data section
    const data = ethers.concat([
      preTransferInHasTarget ? ethers.zeroPadValue(args.preTransferInTarget!, 20) : new Uint8Array(0),
      preTransferInDataBytes,
      postTransferInHasTarget ? ethers.zeroPadValue(args.postTransferInTarget!, 20) : new Uint8Array(0),
      postTransferInDataBytes,
      preTransferOutHasTarget ? ethers.zeroPadValue(args.preTransferOutTarget!, 20) : new Uint8Array(0),
      preTransferOutDataBytes,
      postTransferOutHasTarget ? ethers.zeroPadValue(args.postTransferOutTarget!, 20) : new Uint8Array(0),
      postTransferOutDataBytes,
      programBytes
    ]);

    return {
      maker: maker,
      traits: ethers.zeroPadValue(ethers.toBeHex(traits), 32),
      data: ethers.hexlify(data)
    };
  }
}

// Helper class for building TakerTraits matching swap-vm-alpha implementation
class TakerTraitsLib {
  // Flag constants from TakerTraits.sol
  static readonly IS_EXACT_IN_BIT_FLAG = 0x0001;
  static readonly SHOULD_UNWRAP_BIT_FLAG = 0x0002;
  static readonly HAS_PRE_TRANSFER_IN_CALLBACK_BIT_FLAG = 0x0004;
  static readonly HAS_PRE_TRANSFER_OUT_CALLBACK_BIT_FLAG = 0x0008;
  static readonly IS_STRICT_THRESHOLD_BIT_FLAG = 0x0010;
  static readonly IS_FIRST_TRANSFER_FROM_TAKER_BIT_FLAG = 0x0020;
  static readonly USE_TRANSFER_FROM_AND_AQUA_PUSH_FLAG = 0x0040;

  static build(args: TakerTraitsArgs): string {
    // Convert inputs to bytes
    const toBytes = (data: BytesLike | undefined): Uint8Array => {
      if (!data) return new Uint8Array(0);
      const hex = ethers.hexlify(data);
      return ethers.getBytes(hex);
    };

    // Special handling for threshold - convert BigNumberish to 32-byte value if needed
    let thresholdBytes: Uint8Array;
    if (!args.threshold) {
      thresholdBytes = new Uint8Array(0);
    } else if (typeof args.threshold === 'string' && args.threshold.startsWith('0x')) {
      // It's already hex bytes
      thresholdBytes = ethers.getBytes(args.threshold);
    } else {
      // It's a BigNumberish (number, bigint, or decimal string) - convert to 32 bytes
      thresholdBytes = ethers.getBytes(ethers.zeroPadValue(ethers.toBeHex(args.threshold), 32));
    }

    // Get all data sections as bytes
    const preTransferInHookBytes = toBytes(args.preTransferInHookData);
    const postTransferInHookBytes = toBytes(args.postTransferInHookData);
    const preTransferOutHookBytes = toBytes(args.preTransferOutHookData);
    const postTransferOutHookBytes = toBytes(args.postTransferOutHookData);
    const preTransferInCallbackBytes = toBytes(args.preTransferInCallbackData);
    const preTransferOutCallbackBytes = toBytes(args.preTransferOutCallbackData);
    const instructionsArgsBytes = toBytes(args.instructionsArgs);
    const signatureBytes = toBytes(args.signature);

    // Validate threshold length (must be 32 bytes or empty)
    if (thresholdBytes.length !== 0 && thresholdBytes.length !== 32) {
      throw new Error(`TakerTraitsThresholdLengthInvalid: threshold length must be 0 or 32 bytes, got ${thresholdBytes.length}`);
    }

    // Validate callback data presence matches flags
    if (preTransferInCallbackBytes.length > 0 && !args.hasPreTransferInCallback) {
      throw new Error("TakerTraitsMissingHasPreTransferInFlag: preTransferInCallbackData provided but hasPreTransferInCallback is false");
    }
    if (preTransferOutCallbackBytes.length > 0 && !args.hasPreTransferOutCallback) {
      throw new Error("TakerTraitsMissingHasPreTransferOutFlag: preTransferOutCallbackData provided but hasPreTransferOutCallback is false");
    }

    // Determine if 'to' address should be included
    const shouldIncludeTo = args.to && args.to !== ethers.ZeroAddress && args.to !== args.taker;
    const toAddressBytes = shouldIncludeTo ? ethers.getBytes(ethers.zeroPadValue(args.to!, 20)) : new Uint8Array(0);

    // Calculate slice indexes (cumulative byte positions)
    let index0 = thresholdBytes.length;
    let index1 = index0 + toAddressBytes.length;
    let index2 = index1 + preTransferInHookBytes.length;
    let index3 = index2 + postTransferInHookBytes.length;
    let index4 = index3 + preTransferOutHookBytes.length;
    let index5 = index4 + postTransferOutHookBytes.length;
    let index6 = index5 + preTransferInCallbackBytes.length;
    let index7 = index6 + preTransferOutCallbackBytes.length;
    let index8 = index7 + instructionsArgsBytes.length;
    // Note: signature index is implicit (end of data)

    // Pack slice indexes into 144 bits (18 bytes)
    // Each index is 16 bits, stored in little-endian order within the 144-bit field
    const slicesIndexes = BigInt(index0) << 0n |
                          BigInt(index1) << 16n |
                          BigInt(index2) << 32n |
                          BigInt(index3) << 48n |
                          BigInt(index4) << 64n |
                          BigInt(index5) << 80n |
                          BigInt(index6) << 96n |
                          BigInt(index7) << 112n |
                          BigInt(index8) << 128n;

    // Build flags (16 bits)
    let flags = 0;
    if (args.isExactIn) flags |= this.IS_EXACT_IN_BIT_FLAG;
    if (args.shouldUnwrapWeth) flags |= this.SHOULD_UNWRAP_BIT_FLAG;
    if (args.hasPreTransferInCallback) flags |= this.HAS_PRE_TRANSFER_IN_CALLBACK_BIT_FLAG;
    if (args.hasPreTransferOutCallback) flags |= this.HAS_PRE_TRANSFER_OUT_CALLBACK_BIT_FLAG;
    if (args.isStrictThresholdAmount) flags |= this.IS_STRICT_THRESHOLD_BIT_FLAG;
    if (args.isFirstTransferFromTaker) flags |= this.IS_FIRST_TRANSFER_FROM_TAKER_BIT_FLAG;
    if (args.useTransferFromAndAquaPush) flags |= this.USE_TRANSFER_FROM_AND_AQUA_PUSH_FLAG;

    // Pack everything together
    const packed = ethers.concat([
      // First 18 bytes: slice indexes (144 bits)
      ethers.zeroPadValue(ethers.toBeHex(slicesIndexes), 18),
      // Next 2 bytes: flags (16 bits)
      ethers.zeroPadValue(ethers.toBeHex(flags), 2),
      // Then all the data sections in order
      thresholdBytes,
      toAddressBytes,
      preTransferInHookBytes,
      postTransferInHookBytes,
      preTransferOutHookBytes,
      postTransferOutHookBytes,
      preTransferInCallbackBytes,
      preTransferOutCallbackBytes,
      instructionsArgsBytes,
      signatureBytes
    ]);

    return ethers.hexlify(packed);
  }
}

const AquaOpcodes = {
  // Reserved for debugging utilities
  NOT_INSTRUCTION_1: 0x00,
  NOT_INSTRUCTION_2: 0x01,
  NOT_INSTRUCTION_3: 0x02,
  NOT_INSTRUCTION_4: 0x03,
  NOT_INSTRUCTION_5: 0x04,
  NOT_INSTRUCTION_6: 0x05,
  NOT_INSTRUCTION_7: 0x06,
  NOT_INSTRUCTION_8: 0x07,
  NOT_INSTRUCTION_9: 0x08,
  NOT_INSTRUCTION_10: 0x09,

  // Controls - control flow
  JUMP: 0x0A,                                      // Controls._jump
  JUMP_IF_TOKEN_IN: 0x0B,                          // Controls._jumpIfTokenIn
  JUMP_IF_TOKEN_OUT: 0x0C,                         // Controls._jumpIfTokenOut
  DEADLINE: 0x0D,                                  // Controls._deadline
  ONLY_TAKER_TOKEN_BALANCE_NON_ZERO: 0x0E,         // Controls._onlyTakerTokenBalanceNonZero
  ONLY_TAKER_TOKEN_BALANCE_GTE: 0x0F,              // Controls._onlyTakerTokenBalanceGte
  ONLY_TAKER_TOKEN_SUPPLY_SHARE_GTE: 0x10,         // Controls._onlyTakerTokenSupplyShareGte

  // XYCSwap - basic swap
  XYC_SWAP_XD: 0x11,                               // XYCSwap._xycSwapXD

  // XYCConcentrate - liquidity concentration
  XYC_CONCENTRATE_GROW_LIQUIDITY_XD: 0x12,         // XYCConcentrate._xycConcentrateGrowLiquidityXD
  XYC_CONCENTRATE_GROW_LIQUIDITY_2D: 0x13,         // XYCConcentrate._xycConcentrateGrowLiquidity2D

  // Decay - Decay AMM
  DECAY_XD: 0x14,                                  // Decay._decayXD

  // Additional instructions
  SALT: 0x15,                                      // Controls._salt
  FLAT_FEE_AMOUNT_IN_XD: 0x16,                     // Fee._flatFeeAmountInXD
  FLAT_FEE_AMOUNT_OUT_XD: 0x17,                    // Fee._flatFeeAmountOutXD
  PROGRESSIVE_FEE_IN_XD: 0x18,                     // Fee._progressiveFeeInXD
  PROGRESSIVE_FEE_OUT_XD: 0x19,                    // Fee._progressiveFeeOutXD
  PROTOCOL_FEE_AMOUNT_OUT_XD: 0x1A,                // Fee._protocolFeeAmountOutXD
  AQUA_PROTOCOL_FEE_AMOUNT_OUT_XD: 0x1B            // Fee._aquaProtocolFeeAmountOutXD
};

const Opcodes = {
  // Reserved for debugging utilities
  NOT_INSTRUCTION_1: 0x00,
  NOT_INSTRUCTION_2: 0x01,
  NOT_INSTRUCTION_3: 0x02,
  NOT_INSTRUCTION_4: 0x03,
  NOT_INSTRUCTION_5: 0x04,
  NOT_INSTRUCTION_6: 0x05,
  NOT_INSTRUCTION_7: 0x06,
  NOT_INSTRUCTION_8: 0x07,
  NOT_INSTRUCTION_9: 0x08,
  NOT_INSTRUCTION_10: 0x09,

  // Controls - control flow
  JUMP: 0x0A,                                      // Controls._jump
  JUMP_IF_TOKEN_IN: 0x0B,                          // Controls._jumpIfTokenIn
  JUMP_IF_TOKEN_OUT: 0x0C,                         // Controls._jumpIfTokenOut
  DEADLINE: 0x0D,                                  // Controls._deadline
  ONLY_TAKER_TOKEN_BALANCE_NON_ZERO: 0x0E,         // Controls._onlyTakerTokenBalanceNonZero
  ONLY_TAKER_TOKEN_BALANCE_GTE: 0x0F,              // Controls._onlyTakerTokenBalanceGte
  ONLY_TAKER_TOKEN_SUPPLY_SHARE_GTE: 0x10,         // Controls._onlyTakerTokenSupplyShareGte

  // Balances - balance operations
  STATIC_BALANCES_XD: 0x11,                        // Balances._staticBalancesXD
  DYNAMIC_BALANCES_XD: 0x12,                       // Balances._dynamicBalancesXD

  // Invalidators - order invalidation
  INVALIDATORS_INVALIDATE_BIT_1D: 0x13,            // Invalidators._invalidateBit1D
  INVALIDATORS_INVALIDATE_TOKEN_IN_1D: 0x14,       // Invalidators._invalidateTokenIn1D
  INVALIDATORS_INVALIDATE_TOKEN_OUT_1D: 0x15,      // Invalidators._invalidateTokenOut1D

  // XYCSwap - basic swap
  XYC_SWAP_XD: 0x16,                               // XYCSwap._xycSwapXD

  // XYCConcentrate - liquidity concentration
  XYC_CONCENTRATE_GROW_LIQUIDITY_XD: 0x17,         // XYCConcentrate._xycConcentrateGrowLiquidityXD
  XYC_CONCENTRATE_GROW_LIQUIDITY_2D: 0x18,         // XYCConcentrate._xycConcentrateGrowLiquidity2D

  // Decay - Decay AMM
  DECAY_XD: 0x19,                                  // Decay._decayXD

  // LimitSwap - limit orders
  LIMIT_SWAP_1D: 0x1A,                             // LimitSwap._limitSwap1D
  LIMIT_SWAP_ONLY_FULL_1D: 0x1B,                   // LimitSwap._limitSwapOnlyFull1D

  // MinRate - minimum exchange rate enforcement
  REQUIRE_MIN_RATE_1D: 0x1C,                       // MinRate._requireMinRate1D
  ADJUST_MIN_RATE_1D: 0x1D,                        // MinRate._adjustMinRate1D

  // DutchAuction - auction mechanism
  DUTCH_AUCTION_BALANCE_IN_1D: 0x1E,               // DutchAuction._dutchAuctionBalanceIn1D
  DUTCH_AUCTION_BALANCE_OUT_1D: 0x1F,              // DutchAuction._dutchAuctionBalanceOut1D

  // OraclePriceAdjuster - oracle-based price adjustment
  ORACLE_PRICE_ADJUSTER_1D: 0x20,                  // OraclePriceAdjuster._oraclePriceAdjuster1D

  // BaseFeeAdjuster - gas-based price adjustment
  BASE_FEE_ADJUSTER_1D: 0x21,                      // BaseFeeAdjuster._baseFeeAdjuster1D

  // TWAPSwap - TWAP trading
  TWAP: 0x22,                                      // TWAPSwap._twap

  // Additional instructions
  EXTRUCTION: 0x23,                                 // Extruction._extruction
  SALT: 0x24,                                      // Controls._salt
  FLAT_FEE_AMOUNT_IN_XD: 0x25,                     // Fee._flatFeeAmountInXD
  FLAT_FEE_AMOUNT_OUT_XD: 0x26,                    // Fee._flatFeeAmountOutXD
  PROGRESSIVE_FEE_IN_XD: 0x27,                     // Fee._progressiveFeeInXD
  PROGRESSIVE_FEE_OUT_XD: 0x28,                    // Fee._progressiveFeeOutXD
  PROTOCOL_FEE_AMOUNT_OUT_XD: 0x29,                // Fee._protocolFeeAmountOutXD
  AQUA_PROTOCOL_FEE_AMOUNT_OUT_XD: 0x2A            // Fee._aquaProtocolFeeAmountOutXD
};

export {
  TakerTraitsLib,
  TakerTraitsArgs,
  MakerTraitsLib,
  MakerTraitsArgs,
  AquaOpcodes,
  Opcodes
};

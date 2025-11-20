// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { BigNumberish, BytesLike } from 'ethers';

const { ethers } = require("hardhat");

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

// AquaOpcodes - based on AquaOpcodes.sol from @1inch/swap-vm
const AquaOpcodes = {
  // Reserved for debugging utilities (indices 0-10)
  NOT_INSTRUCTION: 0x00,
  NOT_INSTRUCTION_1: 0x01,
  NOT_INSTRUCTION_2: 0x02,
  NOT_INSTRUCTION_3: 0x03,
  NOT_INSTRUCTION_4: 0x04,
  NOT_INSTRUCTION_5: 0x05,
  NOT_INSTRUCTION_6: 0x06,
  NOT_INSTRUCTION_7: 0x07,
  NOT_INSTRUCTION_8: 0x08,
  NOT_INSTRUCTION_9: 0x09,

  // Controls - control flow (indices 11-17)
  JUMP: 0x0A,                                      // Controls._jump
  JUMP_IF_TOKEN_IN: 0x0B,                          // Controls._jumpIfTokenIn
  JUMP_IF_TOKEN_OUT: 0x0C,                         // Controls._jumpIfTokenOut
  DEADLINE: 0x0D,                                  // Controls._deadline
  ONLY_TAKER_TOKEN_BALANCE_NON_ZERO: 0x0E,         // Controls._onlyTakerTokenBalanceNonZero
  ONLY_TAKER_TOKEN_BALANCE_GTE: 0x0F,              // Controls._onlyTakerTokenBalanceGte
  ONLY_TAKER_TOKEN_SUPPLY_SHARE_GTE: 0x10,         // Controls._onlyTakerTokenSupplyShareGte

  // XYCSwap - basic swap (index 18)
  XYC_SWAP_XD: 0x11,                               // XYCSwap._xycSwapXD

  // XYCConcentrate - liquidity concentration (indices 19-20)
  XYC_CONCENTRATE_GROW_LIQUIDITY_XD: 0x12,         // XYCConcentrate._xycConcentrateGrowLiquidityXD
  XYC_CONCENTRATE_GROW_LIQUIDITY_2D: 0x13,         // XYCConcentrate._xycConcentrateGrowLiquidity2D

  // Decay - Decay AMM (index 21)
  DECAY_XD: 0x14,                                  // Decay._decayXD

  // Additional instructions (indices 22-28)
  SALT: 0x15,                                      // Controls._salt
  FLAT_FEE_AMOUNT_IN_XD: 0x16,                     // Fee._flatFeeAmountInXD
  FLAT_FEE_AMOUNT_OUT_XD: 0x17,                    // Fee._flatFeeAmountOutXD
  PROGRESSIVE_FEE_IN_XD: 0x18,                     // Fee._progressiveFeeInXD
  PROGRESSIVE_FEE_OUT_XD: 0x19,                    // Fee._progressiveFeeOutXD
  PROTOCOL_FEE_AMOUNT_OUT_XD: 0x1A,                // Fee._protocolFeeAmountOutXD
  AQUA_PROTOCOL_FEE_AMOUNT_OUT_XD: 0x1B            // Fee._aquaProtocolFeeAmountOutXD
};

export {
  TakerTraitsLib,
  TakerTraitsArgs,
  AquaOpcodes
};

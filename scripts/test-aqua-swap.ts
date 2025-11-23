// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to test a swap through Aqua DODOSwap pool
 * 
 * Usage:
 *   PRIVATE_KEY=... SWAP_AMOUNT=0.1 npx hardhat run scripts/test-aqua-swap.ts --network sepolia
 */

import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { getDeployedContract, waitForTx, displayBalance, parseTokenAmount, formatTokenAmount } from "./utils/helpers";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { AquaSwapVMRouter } from "../typechain-types/@1inch/swap-vm/src/routers/AquaSwapVMRouter";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";
import { TakerTraitsLib, MakerTraitsLib } from "../test/utils/SwapVMHelpers";

// Contract addresses from deployment
const METH_ADDRESS = "0xC2FB82498d61e136a1d5Dd66Dc5095f4C3aCcbBD";
const MUSDC_ADDRESS = "0xA748Cef1c4E68Cc81448bD061A4aF8FEaD9d5558";
const ORACLE_ADDRESS = "0xB0d9Fe62FEc791bc8e4428bCE47605fF3b2713a5";
const AQUA_ADDRESS = "0x1A2694C890e372b587e8e755eC14E650545aFEca";
const MY_CUSTOM_OPCODES_ADDRESS = "0x3Fd87f63a331730dCbDd179eD07F923DB757a9C6";
const MAKER_ADDRESS = "0xabc4Cbf716472c47a61c8c2c5076895600F3cf10"; // Deployer who created the pool

// Pool parameters (from deployment)
const TARGET_BASE_AMOUNT = ethers.parseEther("3");      // 3 mETH
const TARGET_QUOTE_AMOUNT = ethers.parseEther("8445");  // 8445 mUSDC
const K_PARAMETER = ethers.parseEther("0.1");           // k = 0.1
const BASE_IS_TOKEN_IN = true;                          // Base (mETH) is input token

const DODO_SWAP_OPCODE = 0x1D;

async function buildDODOOrderStruct(
  makerAddress: string,
  oracleAddress: string,
  targetBaseAmount: bigint,
  targetQuoteAmount: bigint,
  k: bigint,
  baseIsTokenIn: boolean
) {
  // Encode DODOParams
  const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address oracle, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"],
    [[
      oracleAddress,
      k,
      targetBaseAmount,
      targetQuoteAmount,
      baseIsTokenIn
    ]]
  );

  // Build program using ProgramBuilder
  const programBuilder = new ProgramBuilder();
  programBuilder.addInstruction(DODO_SWAP_OPCODE, dodoParams);
  const program = programBuilder.build();

  // Use MakerTraitsLib to build order
  const order = MakerTraitsLib.build({
    maker: makerAddress,
    receiver: makerAddress,
    useAquaInsteadOfSignature: true,
    program: program
  });

  return order;
}

async function main() {
  console.log("=== Testing Aqua DODOSwap ===\n");

  // Get private key from environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  // Create wallet from private key
  const provider = ethers.provider;
  const taker = new Wallet(privateKey, provider);
  const takerAddress = await taker.getAddress();

  console.log(`Taker address: ${takerAddress}`);
  console.log(`Network: ${(await provider.getNetwork()).name}\n`);

  // Get contract instances
  const mETH = await ethers.getContractAt("IERC20", METH_ADDRESS);
  const mUSDC = await ethers.getContractAt("IERC20", MUSDC_ADDRESS);
  const router = await ethers.getContractAt("AquaSwapVMRouter", MY_CUSTOM_OPCODES_ADDRESS) as AquaSwapVMRouter;

  // Check balances
  console.log("Initial Balances:");
  const mETHBalance = await mETH.balanceOf(takerAddress);
  const mUSDCBalance = await mUSDC.balanceOf(takerAddress);
  console.log(`  mETH: ${formatTokenAmount(mETHBalance)}`);
  console.log(`  mUSDC: ${formatTokenAmount(mUSDCBalance)}\n`);

  // Determine swap amount
  const swapAmount = process.env.SWAP_AMOUNT 
    ? parseTokenAmount(process.env.SWAP_AMOUNT)
    : ethers.parseEther("0.1"); // Default 0.1 mETH

  console.log(`Swap Configuration:`);
  console.log(`  Swapping: ${formatTokenAmount(swapAmount)} mETH`);
  console.log(`  For: mUSDC`);
  console.log(`  Pool: 3 mETH / 8,445 mUSDC (k=0.1)`);
  console.log(`  Oracle: ${ORACLE_ADDRESS}\n`);

  // Verify sufficient balance
  if (mETHBalance < swapAmount) {
    throw new Error(`Insufficient mETH balance: have ${formatTokenAmount(mETHBalance)}, need ${formatTokenAmount(swapAmount)}`);
  }

  // Approve mETH to MyCustomOpcodes
  const allowance = await mETH.allowance(takerAddress, MY_CUSTOM_OPCODES_ADDRESS);
  console.log(`mETH allowance: ${formatTokenAmount(allowance)}`);

  if (allowance < swapAmount) {
    console.log("⚠️  Insufficient allowance, approving...");
    const approveTx = await mETH.connect(taker).approve(MY_CUSTOM_OPCODES_ADDRESS, ethers.MaxUint256);
    await waitForTx(approveTx, "Approve mETH");
  }

  // Build the DODO order struct
  console.log("\n🔨 Building DODO order struct...");
  const orderStruct = await buildDODOOrderStruct(
    MAKER_ADDRESS,
    ORACLE_ADDRESS,
    TARGET_BASE_AMOUNT,
    TARGET_QUOTE_AMOUNT,
    K_PARAMETER,
    BASE_IS_TOKEN_IN
  );

  console.log(`  Maker: ${orderStruct.maker}`);
  console.log(`  Traits: ${orderStruct.traits}`);
  console.log(`  Data length: ${orderStruct.data.length} bytes\n`);

  // Build taker traits
  const minAmountOut = ethers.parseEther("1"); // Minimum 1 mUSDC output (adjust as needed)
  const takerData = TakerTraitsLib.build({
    taker: takerAddress,
    isExactIn: true,
    threshold: minAmountOut,
    useTransferFromAndAquaPush: true
  });

  // Get quote first
  console.log("📊 Getting quote...");
  try {
    const quote = await router.quote(
      orderStruct,
      METH_ADDRESS,
      MUSDC_ADDRESS,
      swapAmount
    );
    console.log(`  Expected output: ${formatTokenAmount(quote)} mUSDC\n`);
  } catch (error: any) {
    console.log(`  ⚠️  Could not get quote: ${error.message}\n`);
  }

  // Execute swap
  console.log("🔄 Executing swap...");
  try {
    const swapTx = await router.connect(taker).swap(
      orderStruct,
      METH_ADDRESS,
      MUSDC_ADDRESS,
      swapAmount,
      takerData
    );

    const receipt = await waitForTx(swapTx, "Execute swap");

    // Check balances after
    console.log("\nFinal Balances:");
    const mETHBalanceAfter = await mETH.balanceOf(takerAddress);
    const mUSDCBalanceAfter = await mUSDC.balanceOf(takerAddress);
    console.log(`  mETH: ${formatTokenAmount(mETHBalanceAfter)}`);
    console.log(`  mUSDC: ${formatTokenAmount(mUSDCBalanceAfter)}`);

    // Calculate changes
    const mETHChange = mETHBalanceAfter - mETHBalance;
    const mUSDCChange = mUSDCBalanceAfter - mUSDCBalance;
    console.log("\nBalance Changes:");
    console.log(`  mETH: ${mETHChange >= 0n ? '+' : ''}${formatTokenAmount(mETHChange)}`);
    console.log(`  mUSDC: ${mUSDCChange >= 0n ? '+' : ''}${formatTokenAmount(mUSDCChange)}`);

    console.log("\n✅ Swap executed successfully!");
    console.log(`   Transaction: ${receipt.hash}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

  } catch (error: any) {
    console.error("\n❌ Swap failed:");
    console.error(`   Message: ${error.message || error}`);
    if (error.reason) {
      console.error(`   Reason: ${error.reason}`);
    }
    if (error.data) {
      console.error(`   Data: ${error.data}`);
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


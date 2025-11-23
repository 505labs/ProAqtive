/**
 * @file test-both-directions-local.ts
 * @notice Test DODOSwap in BOTH directions on localhost with MockPyth
 * @dev This confirms the fix for buying base tokens with exact quote input
 * 
 * Test Flow:
 *   1. Deploy contracts locally
 *   2. Ship liquidity
 *   3. TEST 1: Sell 0.5 ETH for USDC (base → quote)
 *   4. TEST 2: Buy 0.3 ETH with USDC (quote → base) - THE FIX!
 */

import { ethers } from "hardhat";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";
import { MakerTraitsLib, TakerTraitsLib } from "../test/utils/SwapVMHelpers";
import { ether } from '@1inch/solidity-utils';

// DODO Parameters
const DODO_SWAP_OPCODE = 0x1D;
const K_PARAMETER = ether("0.05");
const TARGET_BASE_AMOUNT = ether("2");
const TARGET_QUOTE_AMOUNT = ether("5600");
const MAX_PRICE_STALENESS = 3600;

// Liquidity amounts
const LIQUIDITY_METH = ether("5");
const LIQUIDITY_MUSDC = ether("15000");

// ETH/USD price (simulated)
const ETH_USD_PRICE = 2800; // $2,800 per ETH
const MOCK_PRICE = BigInt(ETH_USD_PRICE) * BigInt(10 ** 8); // Pyth uses 8 decimals for price
const MOCK_EXPO = -8;
const MOCK_CONFIDENCE = BigInt(100) * BigInt(10 ** 8); // $100 confidence

function formatBalance(balance: bigint, decimals: number = 18): string {
  return ethers.formatUnits(balance, decimals);
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                                                            ║");
  console.log("║   🧪 BOTH DIRECTIONS TEST - LOCAL with MockPyth 🧪        ║");
  console.log("║                                                            ║");
  console.log("║  1. Buy 0.3 ETH with USDC (quote → base) [THE FIX!]       ║");
  console.log("║  2. Sell 0.5 ETH for USDC (base → quote)                  ║");
  console.log("║                                                            ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    const [deployer, maker, taker] = await ethers.getSigners();
    
    console.log("═══ 📋 Deploying Contracts ═══\n");
    
    // Deploy MockPyth (use fully qualified name to avoid ambiguity)
    const MockPyth = await ethers.getContractFactory("contracts/mocks/MockPyth.sol:MockPyth");
    const mockPyth = await MockPyth.deploy();
    await mockPyth.waitForDeployment();
    console.log(`✅ MockPyth: ${await mockPyth.getAddress()}`);
    
    // Set a mock price feed
    const ETH_USD_FEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    await mockPyth.setPrice(ETH_USD_FEED_ID, MOCK_PRICE, MOCK_CONFIDENCE, MOCK_EXPO);
    console.log(`✅ Set ETH/USD feed: $${ETH_USD_PRICE}`);
    
    // Deploy tokens (TokenMock from @1inch/solidity-utils)
    const TokenMock = await ethers.getContractFactory("@1inch/solidity-utils/contracts/mocks/TokenMock.sol:TokenMock");
    const mETH = await TokenMock.deploy("Mock ETH", "mETH");
    await mETH.waitForDeployment();
    const mUSDC = await TokenMock.deploy("Mock USDC", "mUSDC");
    await mUSDC.waitForDeployment();
    console.log(`✅ mETH: ${await mETH.getAddress()}`);
    console.log(`✅ mUSDC: ${await mUSDC.getAddress()}`);
    
    // Deploy Aqua
    const Aqua = await ethers.getContractFactory("Aqua");
    const aqua = await Aqua.deploy();
    await aqua.waitForDeployment();
    console.log(`✅ Aqua: ${await aqua.getAddress()}`);
    
    // Deploy CustomSwapVMRouter (includes MyCustomOpcodes)
    const CustomSwapVMRouter = await ethers.getContractFactory("CustomSwapVMRouter");
    const router = await CustomSwapVMRouter.deploy(
      await aqua.getAddress(),
      "CustomSwapVMRouter",
      "1.0.0"
    );
    await router.waitForDeployment();
    console.log(`✅ CustomSwapVMRouter: ${await router.getAddress()}\n`);

    // Mint tokens to maker
    console.log("═══ 💰 Minting Tokens ═══\n");
    await mETH.mint(maker.address, LIQUIDITY_METH * 2n);
    await mUSDC.mint(maker.address, LIQUIDITY_MUSDC * 2n);
    console.log(`✅ Minted ${formatBalance(LIQUIDITY_METH * 2n)} mETH to maker`);
    console.log(`✅ Minted ${formatBalance(LIQUIDITY_MUSDC * 2n)} mUSDC to maker\n`);
    
    // Mint tokens to taker
    await mETH.mint(taker.address, ether("10"));
    await mUSDC.mint(taker.address, ether("30000"));
    console.log(`✅ Minted 10 mETH to taker`);
    console.log(`✅ Minted 30,000 mUSDC to taker\n`);

    // Approve tokens
    console.log("═══ 🔓 Approving Tokens ═══\n");
    await mETH.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
    await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
    await mETH.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);
    await mUSDC.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);
    console.log("✅ All tokens approved\n");

    // Build ONE DODO order - should work bidirectionally using isExactIn
    console.log("═══ 🔨 Building ONE DODO Order (Bidirectional) ═══\n");
    
    // Build ONE order with baseIsTokenIn=true (base is first token in liquidity array)
    // Contract will determine direction dynamically using isExactIn
    const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address pythContract, bytes32 priceFeedId, uint256 maxStaleness, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"],
      [[
        await mockPyth.getAddress(),
        ETH_USD_FEED_ID,
        MAX_PRICE_STALENESS,
        K_PARAMETER,
        TARGET_BASE_AMOUNT,
        TARGET_QUOTE_AMOUNT,
        true  // base (ETH) is first token - contract will handle both directions
      ]]
    );
    
    const programBuilder = new ProgramBuilder();
    programBuilder.addInstruction(DODO_SWAP_OPCODE, dodoParams);
    const program = programBuilder.build();
    
    const order = MakerTraitsLib.build({
      maker: maker.address,
      receiver: maker.address,
      useAquaInsteadOfSignature: true,
      program: program
    });
    
    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };
    const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address maker, uint256 traits, bytes data)"],
      [orderStruct]
    );
    const orderHash = ethers.keccak256(encodedOrder);
    console.log(`📝 Order Hash: ${orderHash}\n`);

    // Ship liquidity to ONE order
    console.log("═══ 🚢 Shipping Liquidity to ONE Order ═══\n");
    
    const shipTx = await aqua.connect(maker).ship(
      await router.getAddress(),
      encodedOrder,
      [await mETH.getAddress(), await mUSDC.getAddress()],  // [base, quote]
      [LIQUIDITY_METH, LIQUIDITY_MUSDC]
    );
    await shipTx.wait();
    console.log(`✅ Shipped ${formatBalance(LIQUIDITY_METH)} mETH + ${formatBalance(LIQUIDITY_MUSDC)} mUSDC to ONE order\n`);

    // Update price in MockPyth (refresh timestamp)
    console.log("═══ 🔄 Updating MockPyth Price ═══\n");
    await mockPyth.setPrice(ETH_USD_FEED_ID, MOCK_PRICE, MOCK_CONFIDENCE, MOCK_EXPO);
    console.log("✅ MockPyth price updated\n");

    // Get initial LP pool balances
    const [initialPoolMETH, initialTokensCountMETH] = await aqua.rawBalances(
      maker.address,
      await router.getAddress(),
      orderHash,
      await mETH.getAddress()
    );
    const [initialPoolMUSDC, initialTokensCountMUSDC] = await aqua.rawBalances(
      maker.address,
      await router.getAddress(),
      orderHash,
      await mUSDC.getAddress()
    );
    
    console.log("💧 Initial LP Pool Balances:");
    console.log(`  mETH: ${formatBalance(initialPoolMETH)}`);
    console.log(`  mUSDC: ${formatBalance(initialPoolMUSDC)}`);
    const initialPoolPrice = Number(initialPoolMUSDC) / Number(initialPoolMETH);
    console.log(`  Pool Price: $${initialPoolPrice.toFixed(2)} per ETH\n`);

    // ========================================================================
    // TEST 1: Buy 0.3 ETH with USDC (quote → base) - Using ONE order
    // ========================================================================
    console.log("═══ 🧪 TEST 1: BUY 0.3 ETH with USDC (Using ONE order) ═══\n");
    
    const BUY_AMOUNT_ETH = ether("0.3"); // Want exactly 0.3 ETH
    
    const takerTraitsBuy = TakerTraitsLib.build({
      taker: taker.address,
      isExactIn: false,  // Exact ETH output (will calculate USDC input)
      threshold: ethers.MaxUint256, // Accept any USDC cost
      useTransferFromAndAquaPush: true
    });
    
    const mETHBefore1 = await mETH.balanceOf(taker.address);
    const mUSDCBefore1 = await mUSDC.balanceOf(taker.address);
    
    console.log(`Buying ${formatBalance(BUY_AMOUNT_ETH)} mETH with USDC...\n`);
    
    const buyTx = await router.connect(taker).swap(
      orderStruct,             // Use SAME order - contract handles direction via isExactIn
      await mUSDC.getAddress(), // tokenIn (quote)
      await mETH.getAddress(),  // tokenOut (base)
      BUY_AMOUNT_ETH,          // Exact output amount
      takerTraitsBuy
    );
    await buyTx.wait();
    
    const mETHAfter1 = await mETH.balanceOf(taker.address);
    const mUSDCAfter1 = await mUSDC.balanceOf(taker.address);
    
    const mETHChange1 = mETHAfter1 - mETHBefore1;
    const mUSDCChange1 = mUSDCAfter1 - mUSDCBefore1;
    
    console.log("\n📊 Taker Balance Changes:");
    console.log(`  mETH: ${mETHChange1 >= 0n ? '+' : ''}${formatBalance(mETHChange1)}`);
    console.log(`  mUSDC: ${mUSDCChange1 >= 0n ? '+' : ''}${formatBalance(mUSDCChange1 < 0n ? -mUSDCChange1 : mUSDCChange1)}`);
    
    // Get LP pool balances after trade
    const [poolMETH1, tokensCountMETH1] = await aqua.rawBalances(
      maker.address,
      await router.getAddress(),
      orderHash,
      await mETH.getAddress()
    );
    const [poolMUSDC1, tokensCountMUSDC1] = await aqua.rawBalances(
      maker.address,
      await router.getAddress(),
      orderHash,
      await mUSDC.getAddress()
    );
    
    console.log("\n💧 LP Pool Balances After TEST 1:");
    console.log(`  mETH: ${formatBalance(poolMETH1)}`);
    console.log(`  mUSDC: ${formatBalance(poolMUSDC1)}`);
    const poolPrice1 = Number(poolMUSDC1) / Number(poolMETH1);
    console.log(`  Pool Price: $${poolPrice1.toFixed(2)} per ETH`);
    
    if (mETHChange1 > 0n && mUSDCChange1 < 0n) {
      const price1 = Number(-mUSDCChange1) / Number(mETHChange1);
      console.log(`\n  Taker Price Paid: $${price1.toFixed(2)} per ETH`);
      console.log(`  ✅ TEST 1 PASSED - Bought ETH with USDC\n`);
    } else {
      console.log(`  ❌ TEST 1 FAILED - Unexpected balance changes\n`);
      throw new Error("Test 1 failed");
    }

    // ========================================================================
    // TEST 2: Sell 0.5 ETH for USDC (base → quote) - Using SAME order
    // ========================================================================
    console.log("═══ 🧪 TEST 2: SELL 0.5 ETH for USDC (Using SAME order) ═══\n");
    
    const SELL_AMOUNT = ether("0.5");
    
    const takerTraitsSell = TakerTraitsLib.build({
      taker: taker.address,
      isExactIn: true,
      threshold: 0n,
      useTransferFromAndAquaPush: true
    });
    
    const mETHBefore2 = await mETH.balanceOf(taker.address);
    const mUSDCBefore2 = await mUSDC.balanceOf(taker.address);
    
    console.log(`Selling ${formatBalance(SELL_AMOUNT)} mETH...`);
    console.log(`✅ This should work - selling ETH matches baseIsTokenIn=true\n`);
    
    const sellTx = await router.connect(taker).swap(
      orderStruct,              // Use SAME order (baseIsTokenIn=true)
      await mETH.getAddress(),  // tokenIn (base) - matches order direction
      await mUSDC.getAddress(), // tokenOut (quote)
      SELL_AMOUNT,
      takerTraitsSell
    );
    await sellTx.wait();
    
    const mETHAfter2 = await mETH.balanceOf(taker.address);
    const mUSDCAfter2 = await mUSDC.balanceOf(taker.address);
    
    const mETHChange2 = mETHAfter2 - mETHBefore2;
    const mUSDCChange2 = mUSDCAfter2 - mUSDCBefore2;
    
    console.log("\n📊 Taker Balance Changes:");
    console.log(`  mETH: ${mETHChange2 >= 0n ? '+' : ''}${formatBalance(mETHChange2 < 0n ? -mETHChange2 : mETHChange2)}`);
    console.log(`  mUSDC: ${mUSDCChange2 >= 0n ? '+' : ''}${formatBalance(mUSDCChange2)}`);
    
    // Get LP pool balances after trade
    const [poolMETH2, tokensCountMETH2] = await aqua.rawBalances(
      maker.address,
      await router.getAddress(),
      orderHash,
      await mETH.getAddress()
    );
    const [poolMUSDC2, tokensCountMUSDC2] = await aqua.rawBalances(
      maker.address,
      await router.getAddress(),
      orderHash,
      await mUSDC.getAddress()
    );
    
    console.log("\n💧 LP Pool Balances After TEST 2:");
    console.log(`  mETH: ${formatBalance(poolMETH2)}`);
    console.log(`  mUSDC: ${formatBalance(poolMUSDC2)}`);
    const poolPrice2 = Number(poolMUSDC2) / Number(poolMETH2);
    console.log(`  Pool Price: $${poolPrice2.toFixed(2)} per ETH`);
    
    if (mETHChange2 < 0n && mUSDCChange2 > 0n) {
      const price2 = Number(mUSDCChange2) / Number(-mETHChange2);
      console.log(`\n  Taker Price Paid: $${price2.toFixed(2)} per ETH`);
      console.log(`  ✅ TEST 2 PASSED - Sold ETH for USDC\n`);
    } else {
      console.log(`  ❌ TEST 2 FAILED - Unexpected balance changes\n`);
      throw new Error("Test 2 failed");
    }

    // Final summary
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                                                            ║");
    console.log("║         ✅ ALL TESTS PASSED! ✅                            ║");
    console.log("║                                                            ║");
    console.log("║  ONE order works for BOTH directions! 🎉                  ║");
    console.log("║  ✓ Buy ETH with USDC (quote → base)                       ║");
    console.log("║  ✓ Sell ETH for USDC (base → quote)                       ║");
    console.log("║                                                            ║");
    console.log("║  No need for two separate orders!                         ║");
    console.log("║                                                            ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

  } catch (error: any) {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                                                            ║");
    console.log("║                  ❌ TEST FAILED ❌                         ║");
    console.log("║                                                            ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");
    
    console.error(`Error: ${error.message}`);
    if (error.data) {
      console.error(`Data: ${error.data}`);
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


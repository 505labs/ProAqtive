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

    // Build TWO separate DODO orders - one for buying, one for selling
    console.log("═══ 🔨 Building TWO DODO Orders (Buy & Sell) ═══\n");
    
    // ORDER 1: For BUYING base (ETH) with quote (USDC)
    // baseIsTokenIn = false means: base is OUTPUT, quote is INPUT
    const dodoParamsBuy = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address pythContract, bytes32 priceFeedId, uint256 maxStaleness, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"],
      [[
        await mockPyth.getAddress(),
        ETH_USD_FEED_ID,
        MAX_PRICE_STALENESS,
        K_PARAMETER,
        TARGET_BASE_AMOUNT,
        TARGET_QUOTE_AMOUNT,
        false  // base (ETH) is OUTPUT - for buying ETH
      ]]
    );
    
    const programBuilderBuy = new ProgramBuilder();
    programBuilderBuy.addInstruction(DODO_SWAP_OPCODE, dodoParamsBuy);
    const programBuy = programBuilderBuy.build();
    
    const orderBuy = MakerTraitsLib.build({
      maker: maker.address,
      receiver: maker.address,
      useAquaInsteadOfSignature: true,
      program: programBuy
    });
    
    const orderStructBuy = { maker: orderBuy.maker, traits: orderBuy.traits, data: orderBuy.data };
    const encodedOrderBuy = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address maker, uint256 traits, bytes data)"],
      [orderStructBuy]
    );
    const orderHashBuy = ethers.keccak256(encodedOrderBuy);
    console.log(`📝 Buy Order Hash: ${orderHashBuy}`);
    
    // ORDER 2: For SELLING base (ETH) for quote (USDC)
    // baseIsTokenIn = true means: base is INPUT, quote is OUTPUT
    const dodoParamsSell = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address pythContract, bytes32 priceFeedId, uint256 maxStaleness, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"],
      [[
        await mockPyth.getAddress(),
        ETH_USD_FEED_ID,
        MAX_PRICE_STALENESS,
        K_PARAMETER,
        TARGET_BASE_AMOUNT,
        TARGET_QUOTE_AMOUNT,
        true  // base (ETH) is INPUT - for selling ETH
      ]]
    );
    
    const programBuilderSell = new ProgramBuilder();
    programBuilderSell.addInstruction(DODO_SWAP_OPCODE, dodoParamsSell);
    const programSell = programBuilderSell.build();
    
    const orderSell = MakerTraitsLib.build({
      maker: maker.address,
      receiver: maker.address,
      useAquaInsteadOfSignature: true,
      program: programSell
    });
    
    const orderStructSell = { maker: orderSell.maker, traits: orderSell.traits, data: orderSell.data };
    const encodedOrderSell = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address maker, uint256 traits, bytes data)"],
      [orderStructSell]
    );
    const orderHashSell = ethers.keccak256(encodedOrderSell);
    console.log(`📝 Sell Order Hash: ${orderHashSell}\n`);

    // Ship liquidity to BOTH orders
    console.log("═══ 🚢 Shipping Liquidity to Both Orders ═══\n");
    
    // Ship to BUY order
    const shipTxBuy = await aqua.connect(maker).ship(
      await router.getAddress(),
      encodedOrderBuy,
      [await mETH.getAddress(), await mUSDC.getAddress()],
      [LIQUIDITY_METH, LIQUIDITY_MUSDC]
    );
    await shipTxBuy.wait();
    console.log(`✅ Shipped to BUY order: ${formatBalance(LIQUIDITY_METH)} mETH + ${formatBalance(LIQUIDITY_MUSDC)} mUSDC`);
    
    // Ship to SELL order
    const shipTxSell = await aqua.connect(maker).ship(
      await router.getAddress(),
      encodedOrderSell,
      [await mETH.getAddress(), await mUSDC.getAddress()],
      [LIQUIDITY_METH, LIQUIDITY_MUSDC]
    );
    await shipTxSell.wait();
    console.log(`✅ Shipped to SELL order: ${formatBalance(LIQUIDITY_METH)} mETH + ${formatBalance(LIQUIDITY_MUSDC)} mUSDC\n`);

    // Update price in MockPyth (refresh timestamp)
    console.log("═══ 🔄 Updating MockPyth Price ═══\n");
    await mockPyth.setPrice(ETH_USD_FEED_ID, MOCK_PRICE, MOCK_CONFIDENCE, MOCK_EXPO);
    console.log("✅ MockPyth price updated\n");

    // ========================================================================
    // TEST 1: Buy 0.3 ETH with USDC (quote → base) - Using Exact Output
    // ========================================================================
    console.log("═══ 🧪 TEST 1: BUY 0.3 ETH with USDC ═══\n");
    
    const BUY_AMOUNT_ETH = ether("0.3"); // Want exactly 0.3 ETH
    
    const takerTraitsBuy = TakerTraitsLib.build({
      taker: taker.address,
      isExactIn: false,  // Exact ETH output (will calculate USDC input)
      threshold: ethers.MaxUint256, // Accept any USDC cost
      useTransferFromAndAquaPush: true
    });
    
    const mETHBefore1 = await mETH.balanceOf(taker.address);
    const mUSDCBefore1 = await mUSDC.balanceOf(taker.address);
    
    console.log(`Buying ${formatBalance(BUY_AMOUNT_ETH)} mETH with USDC...`);
    
    const buyTx = await router.connect(taker).swap(
      orderStructBuy,          // Use BUY order (baseIsTokenIn=false)
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
    
    console.log("\n📊 Results:");
    console.log(`  mETH: ${mETHChange1 >= 0n ? '+' : ''}${formatBalance(mETHChange1)}`);
    console.log(`  mUSDC: ${mUSDCChange1 >= 0n ? '+' : ''}${formatBalance(mUSDCChange1 < 0n ? -mUSDCChange1 : mUSDCChange1)}`);
    
    if (mETHChange1 > 0n && mUSDCChange1 < 0n) {
      const price1 = Number(-mUSDCChange1) / Number(mETHChange1);
      console.log(`  Price: $${price1.toFixed(2)} per ETH`);
      console.log(`  ✅ TEST 1 PASSED - Bought ETH with USDC\n`);
    } else {
      console.log(`  ❌ TEST 1 FAILED - Unexpected balance changes\n`);
      throw new Error("Test 1 failed");
    }

    // ========================================================================
    // TEST 2: Sell 0.5 ETH for USDC (base → quote)
    // ========================================================================
    console.log("═══ 🧪 TEST 2: SELL 0.5 ETH for USDC ═══\n");
    
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
    
    const sellTx = await router.connect(taker).swap(
      orderStructSell,         // Use SELL order (baseIsTokenIn=true)
      await mETH.getAddress(),  // tokenIn (base)
      await mUSDC.getAddress(), // tokenOut (quote)
      SELL_AMOUNT,
      takerTraitsSell
    );
    await sellTx.wait();
    
    const mETHAfter2 = await mETH.balanceOf(taker.address);
    const mUSDCAfter2 = await mUSDC.balanceOf(taker.address);
    
    const mETHChange2 = mETHAfter2 - mETHBefore2;
    const mUSDCChange2 = mUSDCAfter2 - mUSDCBefore2;
    
    console.log("\n📊 Results:");
    console.log(`  mETH: ${mETHChange2 >= 0n ? '+' : ''}${formatBalance(mETHChange2 < 0n ? -mETHChange2 : mETHChange2)}`);
    console.log(`  mUSDC: ${mUSDCChange2 >= 0n ? '+' : ''}${formatBalance(mUSDCChange2)}`);
    
    if (mETHChange2 < 0n && mUSDCChange2 > 0n) {
      const price2 = Number(mUSDCChange2) / Number(-mETHChange2);
      console.log(`  Price: $${price2.toFixed(2)} per ETH`);
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
    console.log("║  Both directions work correctly:                          ║");
    console.log("║  ✓ Buy ETH with USDC (quote → base)                       ║");
    console.log("║  ✓ Sell ETH for USDC (base → quote)                       ║");
    console.log("║                                                            ║");
    console.log("║  The contract fix is working! 🎉                          ║");
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


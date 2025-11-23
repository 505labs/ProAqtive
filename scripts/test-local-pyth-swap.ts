/**
 * @file test-local-pyth-swap.ts
 * @notice Complete local test of DODOSwap with MockPyth oracle
 * @dev This script:
 *      1. Deploys MockPyth and sets initial price
 *      2. Deploys test tokens (mETH, mUSDC)
 *      3. Deploys Aqua and CustomSwapVMRouter
 *      4. Ships liquidity to Aqua
 *      5. Executes DODO swap with Pyth price feed
 */

import { ethers } from "hardhat";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";
import { MakerTraitsLib, TakerTraitsLib } from "../test/utils/SwapVMHelpers";
import type { CustomSwapVMRouter, MockPyth } from "../typechain-types";
import type { IERC20 } from "../typechain-types";

// ============ Configuration ============

// Price Feed Configuration
const ETH_USD_PRICE_FEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const INITIAL_ETH_PRICE = 3000; // $3000 USD
const PRICE_EXPONENT = -8;      // 8 decimals (standard for USD prices)
const PRICE_CONFIDENCE = 1;     // Confidence interval

// DODO PMM Parameters
const K_PARAMETER = ethers.parseEther("0.1");          // k = 0.1 (moderate slippage)
const TARGET_BASE_AMOUNT = ethers.parseEther("3");     // 3 ETH equilibrium
const TARGET_QUOTE_AMOUNT = ethers.parseEther("9000"); // 9000 USDC equilibrium (3 ETH * $3000)
const BASE_IS_TOKEN_IN = true;                         // Base (mETH) is input token
const MAX_PRICE_STALENESS = 60;                        // 60 seconds

// Liquidity Configuration
const INITIAL_METH_LIQUIDITY = ethers.parseEther("10");   // 10 mETH
const INITIAL_MUSDC_LIQUIDITY = ethers.parseEther("30000"); // 30,000 mUSDC

// Swap Configuration
const SWAP_AMOUNT = ethers.parseEther("0.5"); // Swap 0.5 mETH

const DODO_SWAP_OPCODE = 0x1D;

// ============ Helper Functions ============

function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  return ethers.formatUnits(amount, decimals);
}

async function waitForTx(tx: any, description: string) {
  console.log(`⏳ ${description}...`);
  const receipt = await tx.wait();
  console.log(`✅ ${description} confirmed (Gas: ${receipt.gasUsed.toString()})\n`);
  return receipt;
}

// ============ Main Test Function ============

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  Complete Local Test: DODOSwap with MockPyth Oracle      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  const [deployer, maker, taker] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const makerAddress = await maker.getAddress();
  const takerAddress = await taker.getAddress();

  console.log("👥 Test Accounts:");
  console.log(`   Deployer: ${deployerAddress}`);
  console.log(`   Maker:    ${makerAddress}`);
  console.log(`   Taker:    ${takerAddress}\n`);

  // ============================================================================
  // STEP 1: Deploy MockPyth Oracle
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 1: Deploy MockPyth Oracle");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const MockPythFactory = await ethers.getContractFactory("contracts/mocks/MockPyth.sol:MockPyth");
  const mockPyth = await MockPythFactory.deploy() as MockPyth;
  await mockPyth.waitForDeployment();
  const mockPythAddress = await mockPyth.getAddress();

  console.log(`✅ MockPyth deployed at: ${mockPythAddress}`);

  // Set initial ETH/USD price
  // Convert price to Pyth format: 3000 USD = 300000000000 (with expo -8)
  const pythPrice = INITIAL_ETH_PRICE * Math.pow(10, -PRICE_EXPONENT);
  
  const setPriceTx = await mockPyth.setPrice(
    ETH_USD_PRICE_FEED_ID,
    pythPrice,
    PRICE_CONFIDENCE,
    PRICE_EXPONENT
  );
  await waitForTx(setPriceTx, "Set initial ETH/USD price");

  // Verify price
  const priceData = await mockPyth.getPrice(ETH_USD_PRICE_FEED_ID);
  const readablePrice = Number(priceData.price) * Math.pow(10, Number(priceData.expo));
  console.log(`📊 Current ETH/USD Price: $${readablePrice.toFixed(2)}\n`);

  // ============================================================================
  // STEP 2: Deploy Test Tokens
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 2: Deploy Test Tokens");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const TokenFactory = await ethers.getContractFactory("TokenMock");
  
  const mETH = await TokenFactory.deploy("Mock ETH", "mETH");
  await mETH.waitForDeployment();
  const mETHAddress = await mETH.getAddress();
  
  const mUSDC = await TokenFactory.deploy("Mock USDC", "mUSDC");
  await mUSDC.waitForDeployment();
  const mUSDCAddress = await mUSDC.getAddress();

  console.log(`✅ mETH deployed at:  ${mETHAddress}`);
  console.log(`✅ mUSDC deployed at: ${mUSDCAddress}\n`);

  // Mint tokens to maker and taker
  await waitForTx(
    await mETH.mint(makerAddress, INITIAL_METH_LIQUIDITY),
    "Mint mETH to maker"
  );
  await waitForTx(
    await mUSDC.mint(makerAddress, INITIAL_MUSDC_LIQUIDITY),
    "Mint mUSDC to maker"
  );
  await waitForTx(
    await mETH.mint(takerAddress, ethers.parseEther("10")),
    "Mint mETH to taker"
  );

  // ============================================================================
  // STEP 3: Deploy Aqua and CustomSwapVMRouter
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 3: Deploy Aqua and CustomSwapVMRouter");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const AquaFactory = await ethers.getContractFactory("Aqua");
  const aqua = await AquaFactory.deploy();
  await aqua.waitForDeployment();
  const aquaAddress = await aqua.getAddress();

  console.log(`✅ Aqua deployed at: ${aquaAddress}`);

  const RouterFactory = await ethers.getContractFactory("CustomSwapVMRouter");
  const router = await RouterFactory.deploy(
    aquaAddress,
    "CustomSwapVMRouter",
    "1.0"
  ) as CustomSwapVMRouter;
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  console.log(`✅ CustomSwapVMRouter deployed at: ${routerAddress}\n`);

  // ============================================================================
  // STEP 4: Setup Initial Balances
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 4: Setup Initial Balances");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("✅ Maker has mETH:  " + formatTokenAmount(await mETH.balanceOf(makerAddress)));
  console.log("✅ Maker has mUSDC: " + formatTokenAmount(await mUSDC.balanceOf(makerAddress)));
  console.log("✅ Taker has mETH:  " + formatTokenAmount(await mETH.balanceOf(takerAddress)) + "\n");

  // ============================================================================
  // STEP 5: Update Pyth Price (Before Swap)
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 5: Update Pyth Price");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Create minimal price update data (MockPyth doesn't validate, just checks fee)
  const priceUpdateData = [ethers.hexlify(new Uint8Array(32))];
  
  const updateFee = await mockPyth.getUpdateFee(priceUpdateData);
  console.log(`📊 Pyth Update Fee: ${formatTokenAmount(updateFee)} ETH`);

  // Update price on MockPyth (this would be done by anyone before swaps in production)
  await waitForTx(
    await mockPyth.updatePriceFeeds(priceUpdateData, { value: updateFee }),
    "Update Pyth price feeds"
  );

  // Verify price is still fresh
  const priceAfterUpdate = await mockPyth.getPrice(ETH_USD_PRICE_FEED_ID);
  console.log(`✅ Price still valid: $${(Number(priceAfterUpdate.price) * Math.pow(10, Number(priceAfterUpdate.expo))).toFixed(2)}\n`);

  // ============================================================================
  // STEP 6: Build DODO Order with Pyth Parameters
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 6: Build DODO Order with Pyth Parameters");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Encode DODOParams (price update data removed - prices updated separately)
  const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(address pythContract, bytes32 priceFeedId, uint256 maxStaleness, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"
    ],
    [[
      mockPythAddress,
      ETH_USD_PRICE_FEED_ID,
      MAX_PRICE_STALENESS,
      K_PARAMETER,
      TARGET_BASE_AMOUNT,
      TARGET_QUOTE_AMOUNT,
      BASE_IS_TOKEN_IN
    ]]
  );

  console.log("📋 DODO Parameters:");
  console.log(`   Pyth Contract: ${mockPythAddress}`);
  console.log(`   Price Feed ID: ${ETH_USD_PRICE_FEED_ID}`);
  console.log(`   Max Staleness: ${MAX_PRICE_STALENESS}s`);
  console.log(`   k: ${formatTokenAmount(K_PARAMETER)}`);
  console.log(`   Target Base: ${formatTokenAmount(TARGET_BASE_AMOUNT)} mETH`);
  console.log(`   Target Quote: ${formatTokenAmount(TARGET_QUOTE_AMOUNT)} mUSDC`);
  console.log(`   Base is Token In: ${BASE_IS_TOKEN_IN}`);
  console.log(`   ℹ️  Note: Prices updated separately in Step 5\n`);

  // Build program
  const programBuilder = new ProgramBuilder();
  programBuilder.addInstruction(DODO_SWAP_OPCODE, dodoParams);
  const program = programBuilder.build();

  // Build order
  const order = MakerTraitsLib.build({
    maker: makerAddress,
    receiver: makerAddress,
    useAquaInsteadOfSignature: true,
    program: program
  });

  console.log(`✅ DODO order built successfully\n`);

  // ============================================================================
  // STEP 7: Ship Liquidity to Aqua with Strategy
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 7: Ship Liquidity to Aqua with Strategy");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Approve Aqua to spend maker's tokens
  await waitForTx(
    await mETH.connect(maker).approve(aquaAddress, ethers.MaxUint256),
    "Approve mETH to Aqua"
  );
  await waitForTx(
    await mUSDC.connect(maker).approve(aquaAddress, ethers.MaxUint256),
    "Approve mUSDC to Aqua"
  );

  // Encode the order for shipping
  const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address maker, uint256 traits, bytes data)"],
    [order]
  );

  // Ship liquidity with the encoded order strategy
  await waitForTx(
    await aqua.connect(maker).ship(
      routerAddress,
      encodedOrder, // The encoded order (includes maker, traits, and program)
      [mETHAddress, mUSDCAddress],
      [INITIAL_METH_LIQUIDITY, INITIAL_MUSDC_LIQUIDITY]
    ),
    `Ship liquidity: ${formatTokenAmount(INITIAL_METH_LIQUIDITY)} mETH + ${formatTokenAmount(INITIAL_MUSDC_LIQUIDITY)} mUSDC`
  );

  console.log(`✅ Liquidity shipped to Aqua successfully!\n`);

  // ============================================================================
  // STEP 8: Approve Tokens for Swap  
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 8: Approve Tokens for Swap");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await waitForTx(
    await mETH.connect(taker).approve(routerAddress, ethers.MaxUint256),
    "Approve mETH to router"
  );

  // ============================================================================
  // STEP 9: Get Quote
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 9: Get Swap Quote");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log(`📊 Quote for ${formatTokenAmount(SWAP_AMOUNT)} mETH:`);
  
  try {
    const quote = await router.quote(
      order,
      mETHAddress,
      mUSDCAddress,
      SWAP_AMOUNT
    );
    
    console.log(`   Amount In:  ${formatTokenAmount(quote[0])} mETH`);
    console.log(`   Amount Out: ${formatTokenAmount(quote[1])} mUSDC`);
    
    const effectivePrice = Number(quote[1] * 10000n / quote[0]) / 10000;
    console.log(`   Effective Price: ${effectivePrice.toFixed(2)} mUSDC per mETH\n`);
  } catch (error: any) {
    console.log(`   ⚠️  Quote failed: ${error.message}\n`);
  }

  // ============================================================================
  // STEP 10: Execute Swap
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 10: Execute Swap");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Check balances before
  const takerMETHBefore = await mETH.balanceOf(takerAddress);
  const takerMUSDCBefore = await mUSDC.balanceOf(takerAddress);

  console.log("💰 Balances Before:");
  console.log(`   Taker mETH:  ${formatTokenAmount(takerMETHBefore)}`);
  console.log(`   Taker mUSDC: ${formatTokenAmount(takerMUSDCBefore)}\n`);

  // Build taker traits
  const minAmountOut = ethers.parseEther("1000"); // Minimum 1000 mUSDC
  const takerTraits = TakerTraitsLib.build({
    taker: takerAddress,
    isExactIn: true,
    threshold: minAmountOut,
    useTransferFromAndAquaPush: true
  });

  console.log(`🔄 Executing swap: ${formatTokenAmount(SWAP_AMOUNT)} mETH → mUSDC...`);

  try {
    const swapTx = await router.connect(taker).swap(
      order,
      mETHAddress,
      mUSDCAddress,
      SWAP_AMOUNT,
      takerTraits
    );

    const receipt = await swapTx.wait();
    console.log(`✅ Swap executed successfully!`);
    console.log(`   Transaction: ${receipt.hash}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}\n`);

    // Check balances after
    const takerMETHAfter = await mETH.balanceOf(takerAddress);
    const takerMUSDCAfter = await mUSDC.balanceOf(takerAddress);

    console.log("💰 Balances After:");
    console.log(`   Taker mETH:  ${formatTokenAmount(takerMETHAfter)}`);
    console.log(`   Taker mUSDC: ${formatTokenAmount(takerMUSDCAfter)}\n`);

    // Calculate changes
    const mETHChange = takerMETHAfter - takerMETHBefore;
    const mUSDCChange = takerMUSDCAfter - takerMUSDCBefore;

    console.log("📊 Balance Changes:");
    console.log(`   mETH:  ${mETHChange >= 0n ? '+' : ''}${formatTokenAmount(mETHChange)}`);
    console.log(`   mUSDC: ${mUSDCChange >= 0n ? '+' : ''}${formatTokenAmount(mUSDCChange)}`);

    if (mETHChange < 0n && mUSDCChange > 0n) {
      const actualPrice = Number(mUSDCChange * 10000n / -mETHChange) / 10000;
      console.log(`   Actual Price: ${actualPrice.toFixed(2)} mUSDC per mETH`);
      
      // Calculate expected price from oracle
      const expectedPrice = readablePrice;
      const priceDeviation = ((actualPrice - expectedPrice) / expectedPrice * 100);
      console.log(`   Oracle Price: $${expectedPrice.toFixed(2)}`);
      console.log(`   Price Deviation: ${priceDeviation.toFixed(2)}%`);
    }

    console.log("\n╔═══════════════════════════════════════════════════════════╗");
    console.log("║              ✅ TEST COMPLETED SUCCESSFULLY!              ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");

  } catch (error: any) {
    console.error("\n❌ Swap failed:");
    console.error(`   Message: ${error.message}`);
    if (error.reason) {
      console.error(`   Reason: ${error.reason}`);
    }
    if (error.data) {
      console.error(`   Data: ${error.data}`);
    }
    throw error;
  }
}

// ============ Execute ============

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


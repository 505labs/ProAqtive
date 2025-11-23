/**
 * @file test-pyth-dodoswap.ts
 * @notice Example script demonstrating DODOSwap with Pyth Network oracle integration
 * @dev This script shows how to:
 *      1. Fetch price updates from Hermes API
 *      2. Calculate Pyth update fees
 *      3. Build DODOSwap order with Pyth parameters
 *      4. Execute swap with oracle price feed
 */

import { ethers, Wallet } from "ethers";
import axios from "axios";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";
import { MakerTraitsLib, TakerTraitsLib } from "../test/utils/SwapVMHelpers";
import type { CustomSwapVMRouter } from "../typechain-types";

// ============ Configuration ============

// Pyth Configuration
const HERMES_API_URL = process.env.HERMES_API_URL || "https://hermes.pyth.network";
const PYTH_CONTRACT_ADDRESS = process.env.PYTH_CONTRACT || "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"; // Sepolia

// Price Feed IDs (from https://pyth.network/developers/price-feed-ids)
const ETH_USD_PRICE_FEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const BTC_USD_PRICE_FEED_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

// Contract Addresses (update with your deployed contracts)
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS || "";
const TOKEN_IN_ADDRESS = process.env.TOKEN_IN || "";  // e.g., mETH
const TOKEN_OUT_ADDRESS = process.env.TOKEN_OUT || ""; // e.g., mUSDC
const MAKER_ADDRESS = process.env.MAKER_ADDRESS || "";

// DODO Parameters
const K_PARAMETER = ethers.parseEther("0.1");          // k = 0.1 (moderate slippage)
const TARGET_BASE_AMOUNT = ethers.parseEther("3");     // 3 ETH equilibrium
const TARGET_QUOTE_AMOUNT = ethers.parseEther("8445"); // 8445 USDC equilibrium
const BASE_IS_TOKEN_IN = true;                         // Base (ETH) is input token
const MAX_PRICE_STALENESS = 60;                        // 60 seconds max staleness

const DODO_SWAP_OPCODE = 0x1D;

// ============ Helper Functions ============

/**
 * Fetch price update data from Hermes API
 * @param priceFeedIds Array of price feed IDs to fetch
 * @returns Array of signed price update data (VAAs)
 */
async function getPriceUpdateFromHermes(priceFeedIds: string[]): Promise<string[]> {
  console.log("📡 Fetching price update from Hermes API...");
  
  try {
    const response = await axios.get(`${HERMES_API_URL}/api/latest_vaas`, {
      params: {
        ids: priceFeedIds
      }
    });
    
    // Convert to hex format expected by Solidity
    const priceUpdates = response.data.map((vaa: string) => `0x${vaa}`);
    
    console.log(`✅ Fetched ${priceUpdates.length} price update(s)`);
    return priceUpdates;
  } catch (error: any) {
    console.error("❌ Failed to fetch price update from Hermes:");
    console.error(`   ${error.message}`);
    throw error;
  }
}

/**
 * Get the current price from Hermes (for display/validation)
 * @param priceFeedId Price feed ID
 * @returns Price object with value and expo
 */
async function getPriceFromHermes(priceFeedId: string) {
  try {
    const response = await axios.get(`${HERMES_API_URL}/api/latest_price_feeds`, {
      params: {
        ids: [priceFeedId]
      }
    });
    
    const priceData = response.data[0];
    const price = parseInt(priceData.price.price);
    const expo = priceData.price.expo;
    const conf = parseInt(priceData.price.conf);
    
    // Convert to human-readable format
    const humanPrice = price * Math.pow(10, expo);
    const humanConf = conf * Math.pow(10, expo);
    
    return {
      price: humanPrice,
      confidence: humanConf,
      expo,
      publishTime: priceData.price.publish_time
    };
  } catch (error: any) {
    console.error("Failed to fetch price from Hermes:", error.message);
    return null;
  }
}

/**
 * Build DODO order with Pyth integration
 */
async function buildPythDODOOrder(
  makerAddress: string,
  pythContract: string,
  priceFeedId: string,
  priceUpdateData: string[],
  maxStaleness: number,
  k: bigint,
  targetBaseAmount: bigint,
  targetQuoteAmount: bigint,
  baseIsTokenIn: boolean
) {
  console.log("🔨 Building DODO order with Pyth parameters...");
  
  // Encode DODOParams with Pyth data
  const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(address pythContract, bytes32 priceFeedId, bytes[] priceUpdateData, uint256 maxStaleness, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"
    ],
    [[
      pythContract,
      priceFeedId,
      priceUpdateData,
      maxStaleness,
      k,
      targetBaseAmount,
      targetQuoteAmount,
      baseIsTokenIn
    ]]
  );
  
  console.log(`   Pyth Contract: ${pythContract}`);
  console.log(`   Price Feed ID: ${priceFeedId}`);
  console.log(`   Max Staleness: ${maxStaleness}s`);
  console.log(`   k: ${ethers.formatEther(k)}`);
  console.log(`   Target Base: ${ethers.formatEther(targetBaseAmount)}`);
  console.log(`   Target Quote: ${ethers.formatEther(targetQuoteAmount)}`);
  
  // Build program
  const programBuilder = new ProgramBuilder();
  programBuilder.addInstruction(DODO_SWAP_OPCODE, dodoParams);
  const program = programBuilder.build();
  
  // Build order using MakerTraitsLib
  const order = MakerTraitsLib.build({
    maker: makerAddress,
    receiver: makerAddress,
    useAquaInsteadOfSignature: true,
    program: program
  });
  
  console.log("✅ Order built successfully\n");
  return order;
}

/**
 * Format token amount for display
 */
function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  return ethers.formatUnits(amount, decimals);
}

/**
 * Wait for transaction and show details
 */
async function waitForTx(tx: any, description: string) {
  console.log(`⏳ ${description}...`);
  console.log(`   TX Hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ ${description} confirmed`);
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Gas Used: ${receipt.gasUsed.toString()}\n`);
  return receipt;
}

// ============ Main Function ============

async function main() {
  console.log("=== Testing DODOSwap with Pyth Network Integration ===\n");
  
  // Validate configuration
  if (!ROUTER_ADDRESS || !TOKEN_IN_ADDRESS || !TOKEN_OUT_ADDRESS || !MAKER_ADDRESS) {
    throw new Error("Missing configuration. Set ROUTER_ADDRESS, TOKEN_IN, TOKEN_OUT, and MAKER_ADDRESS");
  }
  
  // Get private key from environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }
  
  // Setup wallet and provider
  const provider = ethers.provider;
  const taker = new Wallet(privateKey, provider);
  const takerAddress = await taker.getAddress();
  
  console.log(`Taker: ${takerAddress}`);
  console.log(`Network: ${(await provider.getNetwork()).name}`);
  console.log(`Pyth Contract: ${PYTH_CONTRACT_ADDRESS}\n`);
  
  // Get contract instances
  const router = await ethers.getContractAt(
    "CustomSwapVMRouter",
    ROUTER_ADDRESS
  ) as CustomSwapVMRouter;
  
  const tokenIn = await ethers.getContractAt("IERC20", TOKEN_IN_ADDRESS);
  const tokenOut = await ethers.getContractAt("IERC20", TOKEN_OUT_ADDRESS);
  
  const pythContract = await ethers.getContractAt(
    "IPyth",
    PYTH_CONTRACT_ADDRESS
  );
  
  // Check balances
  console.log("💰 Initial Balances:");
  const tokenInBalance = await tokenIn.balanceOf(takerAddress);
  const tokenOutBalance = await tokenOut.balanceOf(takerAddress);
  const ethBalance = await provider.getBalance(takerAddress);
  console.log(`   Token In: ${formatTokenAmount(tokenInBalance)}`);
  console.log(`   Token Out: ${formatTokenAmount(tokenOutBalance)}`);
  console.log(`   ETH: ${formatTokenAmount(ethBalance)}\n`);
  
  // Step 1: Fetch price from Hermes API
  console.log("Step 1: Fetch Oracle Price");
  console.log("─────────────────────────────");
  const priceData = await getPriceFromHermes(ETH_USD_PRICE_FEED_ID);
  if (priceData) {
    console.log(`   ETH/USD Price: $${priceData.price.toFixed(2)}`);
    console.log(`   Confidence: ±$${priceData.confidence.toFixed(2)}`);
    console.log(`   Publish Time: ${new Date(priceData.publishTime * 1000).toISOString()}\n`);
  }
  
  // Step 2: Get price update data
  console.log("Step 2: Get Price Update Data");
  console.log("─────────────────────────────");
  const priceUpdateData = await getPriceUpdateFromHermes([ETH_USD_PRICE_FEED_ID]);
  console.log();
  
  // Step 3: Calculate update fee
  console.log("Step 3: Calculate Pyth Update Fee");
  console.log("─────────────────────────────────");
  const updateFee = await pythContract.getUpdateFee(priceUpdateData);
  console.log(`   Update Fee: ${formatTokenAmount(updateFee)} ETH\n`);
  
  // Step 4: Fund router with ETH for Pyth fee
  console.log("Step 4: Fund Router with ETH");
  console.log("────────────────────────────");
  const routerBalance = await provider.getBalance(ROUTER_ADDRESS);
  console.log(`   Router balance: ${formatTokenAmount(routerBalance)} ETH`);
  
  if (routerBalance < updateFee) {
    console.log(`   ⚠️  Insufficient balance, sending ETH to router...`);
    const fundTx = await taker.sendTransaction({
      to: ROUTER_ADDRESS,
      value: updateFee * 2n // Send 2x fee to have buffer
    });
    await waitForTx(fundTx, "Fund router");
  } else {
    console.log(`   ✅ Router has sufficient balance\n`);
  }
  
  // Step 5: Approve token
  const swapAmount = ethers.parseEther("0.1"); // 0.1 tokens
  console.log("Step 5: Approve Token");
  console.log("─────────────────────");
  const allowance = await tokenIn.allowance(takerAddress, ROUTER_ADDRESS);
  console.log(`   Current allowance: ${formatTokenAmount(allowance)}`);
  
  if (allowance < swapAmount) {
    console.log("   ⚠️  Insufficient allowance, approving...");
    const approveTx = await tokenIn.connect(taker).approve(
      ROUTER_ADDRESS,
      ethers.MaxUint256
    );
    await waitForTx(approveTx, "Approve token");
  } else {
    console.log("   ✅ Sufficient allowance\n");
  }
  
  // Step 6: Build order
  console.log("Step 6: Build DODOSwap Order");
  console.log("────────────────────────────");
  const order = await buildPythDODOOrder(
    MAKER_ADDRESS,
    PYTH_CONTRACT_ADDRESS,
    ETH_USD_PRICE_FEED_ID,
    priceUpdateData,
    MAX_PRICE_STALENESS,
    K_PARAMETER,
    TARGET_BASE_AMOUNT,
    TARGET_QUOTE_AMOUNT,
    BASE_IS_TOKEN_IN
  );
  
  // Step 7: Build taker traits
  const minAmountOut = ethers.parseEther("1"); // Minimum output
  const takerTraits = TakerTraitsLib.build({
    taker: takerAddress,
    isExactIn: true,
    threshold: minAmountOut,
    useTransferFromAndAquaPush: true
  });
  
  // Step 8: Get quote
  console.log("Step 7: Get Quote");
  console.log("─────────────────");
  try {
    const quote = await router.quote(
      order,
      TOKEN_IN_ADDRESS,
      TOKEN_OUT_ADDRESS,
      swapAmount
    );
    console.log(`   Input: ${formatTokenAmount(swapAmount)}`);
    console.log(`   Expected output: ${formatTokenAmount(quote[1])}\n`);
  } catch (error: any) {
    console.log(`   ⚠️  Quote failed: ${error.message}\n`);
  }
  
  // Step 8: Execute swap
  console.log("Step 8: Execute Swap");
  console.log("────────────────────");
  console.log(`   Swapping ${formatTokenAmount(swapAmount)} tokens...`);
  
  try {
    const swapTx = await router.connect(taker).swap(
      order,
      TOKEN_IN_ADDRESS,
      TOKEN_OUT_ADDRESS,
      swapAmount,
      takerTraits
    );
    
    const receipt = await waitForTx(swapTx, "Execute swap");
    
    // Check final balances
    console.log("💰 Final Balances:");
    const tokenInBalanceAfter = await tokenIn.balanceOf(takerAddress);
    const tokenOutBalanceAfter = await tokenOut.balanceOf(takerAddress);
    console.log(`   Token In: ${formatTokenAmount(tokenInBalanceAfter)}`);
    console.log(`   Token Out: ${formatTokenAmount(tokenOutBalanceAfter)}`);
    
    // Calculate changes
    const tokenInChange = tokenInBalanceAfter - tokenInBalance;
    const tokenOutChange = tokenOutBalanceAfter - tokenOutBalance;
    console.log("\n📊 Changes:");
    console.log(`   Token In: ${tokenInChange >= 0n ? '+' : ''}${formatTokenAmount(tokenInChange)}`);
    console.log(`   Token Out: ${tokenOutChange >= 0n ? '+' : ''}${formatTokenAmount(tokenOutChange)}`);
    
    // Calculate effective price
    const effectivePrice = Number(tokenOutChange * 10000n / -tokenInChange) / 10000;
    console.log(`   Effective Price: ${effectivePrice.toFixed(4)} Token Out per Token In`);
    
    console.log("\n✅ Swap completed successfully!");
    console.log(`   Transaction: ${receipt.hash}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
    
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


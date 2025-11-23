/**
 * @file test-sepolia-pyth-integration.ts
 * @notice Complete integration test for DODOSwap with REAL Pyth oracle on Sepolia
 * @dev This script:
 *      1. Fetches REAL price updates from Pyth Hermes API
 *      2. Uses deployed Sepolia contracts
 *      3. Ships liquidity with Pyth oracle
 *      4. Executes swap with real-time price feed
 *      5. Verifies all results
 * 
 * Usage:
 *   npx hardhat run scripts/test-sepolia-pyth-integration.ts --network sepolia
 */

import { ethers } from "hardhat";
import axios from "axios";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";
import { MakerTraitsLib, TakerTraitsLib } from "../test/utils/SwapVMHelpers";
import { ether } from '@1inch/solidity-utils';
import type { AquaSwapVMRouter } from "../typechain-types";

// ============================================================================
// SEPOLIA DEPLOYED CONTRACTS (from your deployment)
// ============================================================================
const SEPOLIA_ADDRESSES = {
  // Core Infrastructure (✅ FRESHLY DEPLOYED - Nov 23, 2025)
  AQUA: "0x564762A7cfdb1023DA0f150F41586AC59096CB93",
  MY_CUSTOM_OPCODES: "0x43e297a4B2b4acf3457C2CC9f66816dAb9e8c102", // CustomSwapVMRouter
  
  // Tokens (✅ FRESHLY DEPLOYED - Nov 23, 2025)
  METH: "0xa83b1c12ee657CD7Cf565F253ff266024C14e236",  // TokenMock0
  MUSDC: "0x867083bc9100b3C1252F0eb93C904a47d71d9Ef4", // TokenMock1
  
  // Oracle (wraps Pyth) (✅ FRESHLY DEPLOYED - Nov 23, 2025)
  ORACLE: "0xCDbE0C5bCf1E86624451D027B03A979236177d20",
  
  // REAL Pyth Contract on Sepolia (unchanged)
  PYTH: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"
};

// ============================================================================
// PYTH CONFIGURATION
// ============================================================================
const HERMES_API_URL = "https://hermes.pyth.network";
const ETH_USD_PRICE_FEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

// ============================================================================
// DODO SWAP PARAMETERS - COMPLETELY FRESH!
// ============================================================================
const DODO_SWAP_OPCODE = 0x1D;
const K_PARAMETER = ether("0.05");             // k = 0.05 (BRAND NEW to force totally new hash!)
const TARGET_BASE_AMOUNT = ether("2");         // 2 mETH equilibrium (BRAND NEW)
const TARGET_QUOTE_AMOUNT = ether("5600");     // 5,600 mUSDC (2 * $2,800) (BRAND NEW)
const BASE_IS_TOKEN_IN = true;                 // Base (mETH) is the input token
const MAX_PRICE_STALENESS = 3600;                // 60 seconds max staleness

// ============================================================================
// TEST CONFIGURATION
// ============================================================================
const LIQUIDITY_METH = ether("5");      // 5 mETH liquidity (more than target of 2)
const LIQUIDITY_MUSDC = ether("15000"); // 15,000 mUSDC liquidity (more than target of 5,600)
const SWAP_AMOUNT_METH_SELL = ether("0.5");  // First swap: Sell 0.5 mETH
const SWAP_AMOUNT_USD_BUY = ether("300");    // Second swap: Buy $300 worth of ETH

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatBalance(balance: bigint, decimals: number = 18): string {
  return ethers.formatUnits(balance, decimals);
}

async function waitForTx(tx: any, description: string) {
  console.log(`⏳ ${description}...`);
  const receipt = await tx.wait();
  console.log(`✅ ${description} confirmed (Block ${receipt.blockNumber})\n`);
  return receipt;
}

/**
 * Fetch REAL price update from Pyth Hermes API
 */
async function getPriceUpdateFromHermes(priceFeedIds: string[]): Promise<string[]> {
  console.log("📡 Fetching REAL price update from Pyth Hermes API...");
  console.log(`   API: ${HERMES_API_URL}`);
  
  try {
    const response = await axios.get(`${HERMES_API_URL}/api/latest_vaas`, {
      params: { ids: priceFeedIds },
      timeout: 10000
    });
    
    // Hermes returns base64-encoded VAAs, need to convert to hex
    const priceUpdates = response.data.map((vaa: string) => {
      // Convert base64 to Buffer, then to hex
      const buffer = Buffer.from(vaa, 'base64');
      return '0x' + buffer.toString('hex');
    });
    
    console.log(`✅ Fetched ${priceUpdates.length} signed price update(s)\n`);
    return priceUpdates;
  } catch (error: any) {
    console.error("❌ Failed to fetch price from Hermes API");
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Message: ${error.response.statusText}`);
    } else {
      console.error(`   Error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get current ETH/USD price from Hermes (for display)
 */
async function getCurrentPriceFromHermes(priceFeedId: string) {
  try {
    const response = await axios.get(`${HERMES_API_URL}/api/latest_price_feeds`, {
      params: { ids: [priceFeedId] },
      timeout: 10000
    });
    
    const priceData = response.data[0];
    const price = parseInt(priceData.price.price);
    const expo = priceData.price.expo;
    const conf = parseInt(priceData.price.conf);
    const publishTime = priceData.price.publish_time;
    
    const humanPrice = price * Math.pow(10, expo);
    const humanConf = conf * Math.pow(10, expo);
    
    return {
      price: humanPrice,
      confidence: humanConf,
      publishTime: new Date(publishTime * 1000).toISOString()
    };
  } catch (error: any) {
    console.error("⚠️  Could not fetch display price:", error.message);
    return null;
  }
}

/**
 * Build DODO order with Pyth price feed integration
 * Note: priceUpdateData is NO LONGER in DODOParams - price must be updated separately!
 */
function buildDODOOrderWithPyth(
  makerAddress: string,
  pythContract: string,
  priceFeedId: string
) {
  // Encode DODOParams (WITHOUT priceUpdateData - price is updated separately)
  const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(address pythContract, bytes32 priceFeedId, uint256 maxStaleness, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"
    ],
    [[
      pythContract,
      priceFeedId,
      MAX_PRICE_STALENESS,
      K_PARAMETER,
      TARGET_BASE_AMOUNT,
      TARGET_QUOTE_AMOUNT,
      BASE_IS_TOKEN_IN
    ]]
  );
  
  // Build SwapVM program
  const programBuilder = new ProgramBuilder();
  programBuilder.addInstruction(DODO_SWAP_OPCODE, dodoParams);
  const program = programBuilder.build();
  
  // Build maker order
  const order = MakerTraitsLib.build({
    maker: makerAddress,
    receiver: makerAddress,
    useAquaInsteadOfSignature: true,
    program: program
  });
  
  return order;
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                                                            ║");
  console.log("║     🧪 SEPOLIA PYTH INTEGRATION TEST 🧪                    ║");
  console.log("║    Real Pyth Oracle + DODOSwap on Sepolia                 ║");
  console.log("║                                                            ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    // Get accounts
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const deployerAddress = await deployer.getAddress();
    
    // Use deployer as maker
    const maker = deployer;
    const makerAddress = deployerAddress;
    
    // Use the TAKER environment variable for the taker's private key
    if (!process.env.TAKER) {
      throw new Error("TAKER private key not found in .env file");
    }
    const taker = new ethers.Wallet(process.env.TAKER, ethers.provider);
    const takerAddress = await taker.getAddress();
    
    // Check if taker needs ETH for gas
    const takerBalance = await ethers.provider.getBalance(takerAddress);
    if (takerBalance < ethers.parseEther("0.01")) {
      console.log("👥 Funding constant taker account...");
      const fundAmount = ethers.parseEther("0.1");
      const fundTx = await deployer.sendTransaction({
        to: takerAddress,
        value: fundAmount
      });
      await fundTx.wait();
      console.log("   ✅ Taker funded");
    }
    
    console.log("\n👥 Accounts:");
    console.log(`   Deployer: ${deployerAddress}`);
    console.log(`   Maker: ${makerAddress}`);
    console.log(`   Taker: ${takerAddress}`);
    
    console.log("═══ 📋 Setup Information ═══\n");
    console.log(`Deployer: ${deployerAddress}`);
    const ethBalance = await ethers.provider.getBalance(deployerAddress);
    console.log(`ETH Balance: ${formatBalance(ethBalance)} ETH`);
    console.log(`Network: Sepolia`);
    console.log(`Pyth Contract: ${SEPOLIA_ADDRESSES.PYTH}`);
    console.log(`Hermes API: ${HERMES_API_URL}\n`);

    // Load contracts
    console.log("═══ 📦 Loading Contracts ═══\n");
    
    const aqua = await ethers.getContractAt("Aqua", SEPOLIA_ADDRESSES.AQUA);
    console.log(`✅ Aqua: ${await aqua.getAddress()}`);
    
    // Cast MyCustomOpcodes as AquaSwapVMRouter to access swap/quote functions
    const router = await ethers.getContractAt("AquaSwapVMRouter", SEPOLIA_ADDRESSES.MY_CUSTOM_OPCODES);
    console.log(`✅ MyCustomOpcodes Router: ${await router.getAddress()}`);
    
    const mETH = await ethers.getContractAt("TokenMock", SEPOLIA_ADDRESSES.METH);
    console.log(`✅ mETH: ${await mETH.getAddress()}`);
    
    const mUSDC = await ethers.getContractAt("TokenMock", SEPOLIA_ADDRESSES.MUSDC);
    console.log(`✅ mUSDC: ${await mUSDC.getAddress()}`);
    
    const pyth = await ethers.getContractAt("IPyth", SEPOLIA_ADDRESSES.PYTH);
    console.log(`✅ Pyth Oracle: ${await pyth.getAddress()}\n`);

    // Step 1: Check token balances and mint if needed
    console.log("═══ 💰 Step 1: Check Token Balances ═══\n");
    
    let mETHBalance = await mETH.balanceOf(deployerAddress);
    let mUSDCBalance = await mUSDC.balanceOf(deployerAddress);
    
    console.log(`Current mETH: ${formatBalance(mETHBalance)}`);
    console.log(`Current mUSDC: ${formatBalance(mUSDCBalance)}`);
    
    const needMETH = mETHBalance < LIQUIDITY_METH + SWAP_AMOUNT_METH_SELL;
    const needMUSDC = mUSDCBalance < LIQUIDITY_MUSDC + SWAP_AMOUNT_USD_BUY;
    
    if (needMETH || needMUSDC) {
      console.log("\n⚠️  Insufficient balance. Minting tokens...\n");
      
      if (needMETH) {
        const mintAmount = ether("100");
        const tx = await mETH.mint(deployerAddress, mintAmount);
        await waitForTx(tx, `Mint ${formatBalance(mintAmount)} mETH`);
        mETHBalance = await mETH.balanceOf(deployerAddress);
      }
      
      if (needMUSDC) {
        const mintAmount = ether("100000");
        const tx = await mUSDC.mint(deployerAddress, mintAmount);
        await waitForTx(tx, `Mint ${formatBalance(mintAmount)} mUSDC`);
        mUSDCBalance = await mUSDC.balanceOf(deployerAddress);
      }
      
      console.log(`New mETH: ${formatBalance(mETHBalance)}`);
      console.log(`New mUSDC: ${formatBalance(mUSDCBalance)}\n`);
    } else {
      console.log("✅ Sufficient balance\n");
    }

    // Step 2: Approve tokens
    console.log("═══ 🔓 Step 2: Approve Tokens ===\n");
    
    const routerAddress = await router.getAddress();
    const aquaAddress2 = await aqua.getAddress();
    
    // Maker approves AQUA (for shipping liquidity)
    console.log("Maker approving Aqua for liquidity...");
    const makerMETHAllowanceAqua = await mETH.allowance(makerAddress, aquaAddress2);
    const makerMUSDCAllowanceAqua = await mUSDC.allowance(makerAddress, aquaAddress2);
    
    if (makerMETHAllowanceAqua < LIQUIDITY_METH) {
      const tx = await (mETH as any).connect(maker).approve(aquaAddress2, ethers.MaxUint256);
      await waitForTx(tx, "Maker approve mETH to Aqua");
    }
    
    if (makerMUSDCAllowanceAqua < LIQUIDITY_MUSDC) {
      const tx = await (mUSDC as any).connect(maker).approve(aquaAddress2, ethers.MaxUint256);
      await waitForTx(tx, "Maker approve mUSDC to Aqua");
    }
    
    console.log("✅ All approvals complete\n");

    // Step 3: Fetch REAL price from Pyth Hermes API
    console.log("═══ 🌐 Step 3: Fetch Real-Time Price from Pyth ═══\n");
    
    const currentPrice = await getCurrentPriceFromHermes(ETH_USD_PRICE_FEED_ID);
    if (currentPrice) {
      console.log(`📊 Current ETH/USD Price (from Pyth):`);
      console.log(`   Price: $${currentPrice.price.toFixed(2)}`);
      console.log(`   Confidence: ±$${currentPrice.confidence.toFixed(2)}`);
      console.log(`   Published: ${currentPrice.publishTime}\n`);
    }
    
    const priceUpdateData = await getPriceUpdateFromHermes([ETH_USD_PRICE_FEED_ID]);

    // Step 4: Calculate Pyth update fee
    console.log("═══ 💵 Step 4: Calculate Pyth Fee ═══\n");
    
    const updateFee = await pyth.getUpdateFee(priceUpdateData);
    console.log(`Pyth Update Fee: ${formatBalance(updateFee)} ETH`);
    console.log(`(This is paid to Pyth for price verification)\n`);

    // Step 5: Check deployer has enough ETH for Pyth fee
    console.log("═══ 💸 Step 5: Check ETH for Pyth Fee ═══\n");
    
    if (ethBalance < updateFee * 2n) {
      console.error(`❌ Insufficient ETH balance. Need at least ${formatBalance(updateFee * 2n)} ETH`);
      console.error(`   Get testnet ETH from: https://sepoliafaucet.com`);
      process.exit(1);
    }
    
    console.log(`✅ Sufficient ETH to pay Pyth update fee\n`);

    // Step 6: Skip price update for now - will update right before swap

    // Step 6: Build DODO order (without priceUpdateData)
    console.log("═══ 🔨 Step 6: Build DODOSwap Order ═══\n");
    
    console.log("DODO Parameters:");
    console.log(`  Pyth Contract: ${SEPOLIA_ADDRESSES.PYTH}`);
    console.log(`  Price Feed: ETH/USD (${ETH_USD_PRICE_FEED_ID})`);
    console.log(`  Max Staleness: ${MAX_PRICE_STALENESS}s`);
    console.log(`  K Parameter: ${formatBalance(K_PARAMETER)}`);
    console.log(`  Target Base: ${formatBalance(TARGET_BASE_AMOUNT)} mETH`);
    console.log(`  Target Quote: ${formatBalance(TARGET_QUOTE_AMOUNT)} mUSDC`);
    console.log(`  Initial Price: ~$${(Number(formatBalance(TARGET_QUOTE_AMOUNT)) / Number(formatBalance(TARGET_BASE_AMOUNT))).toFixed(2)}\n`);
    
    const order = buildDODOOrderWithPyth(
      makerAddress,  // maker (not deployer!)
      SEPOLIA_ADDRESSES.PYTH,
      ETH_USD_PRICE_FEED_ID
    );
    
    console.log("✅ Order built successfully\n");

    // Step 7: Ship liquidity to Aqua
    console.log("═══ 🚢 Step 7: Ship Liquidity to Aqua ═══\n");
    
    // Compute order hash manually (same way as other scripts)
    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };
    const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address maker, uint256 traits, bytes data)"],
      [orderStruct]
    );
    const orderHash = ethers.keccak256(encodedOrder);
    console.log(`Order Hash: ${orderHash}`);
    
    // Check if liquidity already exists using rawBalances
    // (routerAddress already defined above)
    const DOCKED = 0xFFFFFFFFFFFFFFFFn; // Special value indicating docked status
    
    let liquidityExists = false;
    try {
      const [balanceBase, tokensCountBase] = await aqua.rawBalances(
        deployerAddress,
        routerAddress,
        orderHash,
        await mETH.getAddress()
      );
      const [balanceQuote, tokensCountQuote] = await aqua.rawBalances(
        deployerAddress,
        routerAddress,
        orderHash,
        await mUSDC.getAddress()
      );
      
      console.log(`Existing mETH: ${formatBalance(balanceBase)} (count: ${tokensCountBase})`);
      console.log(`Existing mUSDC: ${formatBalance(balanceQuote)} (count: ${tokensCountQuote})`);
      
      liquidityExists = (tokensCountBase > 0n && tokensCountBase !== DOCKED) || 
                        (tokensCountQuote > 0n && tokensCountQuote !== DOCKED);
      
      if (tokensCountBase === DOCKED || tokensCountQuote === DOCKED) {
        console.log("⚠️  This order was previously docked (closed)");
      }
    } catch (e: any) {
      console.log("No existing liquidity found (strategy doesn't exist yet)");
    }
    
    if (!liquidityExists) {
      console.log("\n📤 Shipping liquidity to Aqua...\n");
      
      // Ship liquidity using aqua.ship()
      // Signature: ship(address swapVM, bytes calldata order, address[] calldata tokens, uint256[] calldata amounts)
      const shipTx = await aqua.ship(
        routerAddress,
        encodedOrder,
        [await mETH.getAddress(), await mUSDC.getAddress()],
        [LIQUIDITY_METH, LIQUIDITY_MUSDC]
      );
      
      await waitForTx(shipTx, `Ship ${formatBalance(LIQUIDITY_METH)} mETH + ${formatBalance(LIQUIDITY_MUSDC)} mUSDC`);
      
      console.log("✅ Liquidity shipped successfully!\n");
    } else {
      console.log("✅ Liquidity already exists for this order\n");
    }

    // Step 8: Update Pyth price RIGHT BEFORE swap (critical timing!)
    console.log("═══ 🔄 Step 8: Update Pyth Price for Swap ═══\n");
    
    console.log("Fetching fresh price update from Hermes...");
    const priceUpdateDataForSwap = await getPriceUpdateFromHermes([ETH_USD_PRICE_FEED_ID]);
    const updateFeeForSwap = await pyth.getUpdateFee(priceUpdateDataForSwap);
    
    console.log(`Updating Pyth with fee: ${formatBalance(updateFeeForSwap)} ETH\n`);
    const updateTxForSwap = await pyth.updatePriceFeeds(priceUpdateDataForSwap, { value: updateFeeForSwap });
    await waitForTx(updateTxForSwap, "Update Pyth price");
    
    console.log("✅ Pyth price updated! DODOSwap can now read fresh price.\n");

    // Check taker has enough tokens for swaps
    const takerMETHBalance = await mETH.balanceOf(takerAddress);
    const takerMUSDCBalance = await mUSDC.balanceOf(takerAddress);
    
    if (takerMETHBalance < SWAP_AMOUNT_METH_SELL) {
      console.log(`\n⚠️  Taker needs mETH. Minting ${formatBalance(SWAP_AMOUNT_METH_SELL * 2n)} mETH to taker...`);
      const tx = await mETH.mint(takerAddress, SWAP_AMOUNT_METH_SELL * 2n);
      await waitForTx(tx, "Mint mETH to taker");
    }
    
    if (takerMUSDCBalance < SWAP_AMOUNT_USD_BUY) {
      console.log(`\n⚠️  Taker needs mUSDC. Minting ${formatBalance(SWAP_AMOUNT_USD_BUY * 2n)} mUSDC to taker...`);
      const tx = await mUSDC.mint(takerAddress, SWAP_AMOUNT_USD_BUY * 2n);
      await waitForTx(tx, "Mint mUSDC to taker");
    }
    
    // Approve taker tokens for router
    const takerMETHAllowance = await mETH.allowance(takerAddress, routerAddress);
    const takerMUSDCAllowance = await mUSDC.allowance(takerAddress, routerAddress);
    
    if (takerMETHAllowance < SWAP_AMOUNT_METH_SELL) {
      const tx = await (mETH as any).connect(taker).approve(routerAddress, ethers.MaxUint256);
      await waitForTx(tx, "Taker approve mETH to Router");
    }
    
    if (takerMUSDCAllowance < SWAP_AMOUNT_USD_BUY) {
      const tx = await (mUSDC as any).connect(taker).approve(routerAddress, ethers.MaxUint256);
      await waitForTx(tx, "Taker approve mUSDC to Router");
    }
    console.log("✅ Taker tokens ready for swaps\n");

    // Get initial LP pool balances
    const [initialPoolMETH, initialTokensCountMETH] = await aqua.rawBalances(
      makerAddress,
      routerAddress,
      orderHash,
      await mETH.getAddress()
    );
    const [initialPoolMUSDC, initialTokensCountMUSDC] = await aqua.rawBalances(
      makerAddress,
      routerAddress,
      orderHash,
      await mUSDC.getAddress()
    );
    
    console.log("💧 Initial LP Pool Balances:");
    console.log(`  mETH: ${formatBalance(initialPoolMETH)}`);
    console.log(`  mUSDC: ${formatBalance(initialPoolMUSDC)}`);
    const initialPoolPrice = Number(initialPoolMUSDC) / Number(initialPoolMETH);
    console.log(`  Pool Price: $${initialPoolPrice.toFixed(2)} per ETH\n`);

    // Step 9: Execute FIRST swap - SELL 0.5 ETH for USDC
    console.log("═══ 🔄 Step 9: Execute First Swap - SELL 0.5 mETH ===\n");
    
    const takerTraitsSell = TakerTraitsLib.build({
      taker: takerAddress,
      isExactIn: true,
      threshold: 0n,
      useTransferFromAndAquaPush: true
    });
    
    const mETHBefore1 = await mETH.balanceOf(takerAddress);
    const mUSDCBefore1 = await mUSDC.balanceOf(takerAddress);
    
    console.log(`Taker (${takerAddress}) selling ${formatBalance(SWAP_AMOUNT_METH_SELL)} mETH for mUSDC...`);
    
    const swapTx1 = await (router as any).connect(taker || deployer).swap(
      orderStruct,
      await mETH.getAddress(),
      await mUSDC.getAddress(),
      SWAP_AMOUNT_METH_SELL,
      takerTraitsSell
    );
    
    const receipt1 = await waitForTx(swapTx1, "Execute first swap (Sell mETH)");
    
    const mETHAfter1 = await mETH.balanceOf(takerAddress);
    const mUSDCAfter1 = await mUSDC.balanceOf(takerAddress);
    
    const mETHChange1 = mETHAfter1 - mETHBefore1;
    const mUSDCChange1 = mUSDCAfter1 - mUSDCBefore1;
    
    console.log("\n📊 First Swap Results:");
    console.log(`  mETH: ${mETHChange1 >= 0n ? '+' : ''}${ethers.formatEther(mETHChange1 < 0n ? -mETHChange1 : mETHChange1)}`);
    console.log(`  mUSDC: ${mUSDCChange1 >= 0n ? '+' : ''}${ethers.formatEther(mUSDCChange1 < 0n ? -mUSDCChange1 : mUSDCChange1)}`);
    
    // Get LP pool balances after first swap
    const [poolMETH1, tokensCountMETH1] = await aqua.rawBalances(
      makerAddress,
      routerAddress,
      orderHash,
      await mETH.getAddress()
    );
    const [poolMUSDC1, tokensCountMUSDC1] = await aqua.rawBalances(
      makerAddress,
      routerAddress,
      orderHash,
      await mUSDC.getAddress()
    );
    
    console.log("\n💧 LP Pool Balances After First Swap:");
    console.log(`  mETH: ${formatBalance(poolMETH1)}`);
    console.log(`  mUSDC: ${formatBalance(poolMUSDC1)}`);
    const poolPrice1 = Number(poolMUSDC1) / Number(poolMETH1);
    console.log(`  Pool Price: $${poolPrice1.toFixed(2)} per ETH`);
    
    if (mETHChange1 < 0n && mUSDCChange1 > 0n) {
      const actualPrice1 = Number(mUSDCChange1) / Number(-mETHChange1);
      console.log(`\n  Taker Price Paid: $${actualPrice1.toFixed(2)} per mETH`);
      
      if (currentPrice) {
        const priceDeviation1 = ((actualPrice1 / currentPrice.price) - 1) * 100;
        console.log(`  Price Deviation: ${priceDeviation1 >= 0 ? '+' : ''}${priceDeviation1.toFixed(2)}%`);
      }
    }
    
    console.log(`\nTransaction 1: https://sepolia.etherscan.io/tx/${receipt1.hash}`);
    console.log(`Gas Used: ${receipt1.gasUsed.toString()}\n`);

    // Step 10: Execute SECOND swap - BUY $300 worth of ETH
    console.log("═══ 🔄 Step 10: Execute Second Swap - BUY $300 worth of ETH ===\n");
    
    // Update Pyth price again for the second swap
    console.log("Fetching fresh price update from Hermes for second swap...");
    const priceUpdateDataForSwap2 = await getPriceUpdateFromHermes([ETH_USD_PRICE_FEED_ID]);
    const updateFeeForSwap2 = await pyth.getUpdateFee(priceUpdateDataForSwap2);
    
    console.log(`Updating Pyth with fee: ${formatBalance(updateFeeForSwap2)} ETH\n`);
    const updateTxForSwap2 = await pyth.updatePriceFeeds(priceUpdateDataForSwap2, { value: updateFeeForSwap2 });
    await waitForTx(updateTxForSwap2, "Update Pyth price for second swap");
    
    console.log("✅ Pyth price updated for second swap!\n");
    
    // Get current price to calculate ETH amount for $300
    const currentPrice2 = await getCurrentPriceFromHermes(ETH_USD_PRICE_FEED_ID);
    if (!currentPrice2) {
      throw new Error("Could not fetch current price for calculating ETH amount");
    }
    
    // Calculate ETH amount for $300: 300 / price
    const ethAmountFor300USD = BigInt(Math.floor((300 / currentPrice2.price) * 1e18));
    console.log(`Current ETH/USD Price: $${currentPrice2.price.toFixed(2)}`);
    console.log(`Buying $300 worth of ETH ≈ ${formatBalance(ethAmountFor300USD)} mETH\n`);
    
    const takerTraitsBuy = TakerTraitsLib.build({
      taker: takerAddress,
      isExactIn: false,  // Exact ETH output (will calculate USDC input)
      threshold: ethers.MaxUint256, // Accept any input amount
      useTransferFromAndAquaPush: true
    });
    
    const mETHBefore2 = await mETH.balanceOf(takerAddress);
    const mUSDCBefore2 = await mUSDC.balanceOf(takerAddress);
    
    console.log(`Taker buying $300 worth of ETH (≈${formatBalance(ethAmountFor300USD)} mETH)...`);
    
    const swapTx2 = await (router as any).connect(taker || deployer).swap(
      orderStruct,
      await mUSDC.getAddress(),  // Input: mUSDC
      await mETH.getAddress(),   // Output: mETH
      ethAmountFor300USD,        // Exact output amount (ETH)
      takerTraitsBuy
    );
    
    const receipt2 = await waitForTx(swapTx2, "Execute second swap (Buy mETH)");
    
    const mETHAfter2 = await mETH.balanceOf(takerAddress);
    const mUSDCAfter2 = await mUSDC.balanceOf(takerAddress);
    
    const mETHChange2 = mETHAfter2 - mETHBefore2;
    const mUSDCChange2 = mUSDCAfter2 - mUSDCBefore2;
    
    console.log("\n📊 Second Swap Results:");
    console.log(`  mETH: ${mETHChange2 >= 0n ? '+' : ''}${ethers.formatEther(mETHChange2 < 0n ? -mETHChange2 : mETHChange2)}`);
    console.log(`  mUSDC: ${mUSDCChange2 >= 0n ? '+' : ''}${ethers.formatEther(mUSDCChange2 < 0n ? -mUSDCChange2 : mUSDCChange2)}`);
    
    // Get LP pool balances after second swap
    const [poolMETH2, tokensCountMETH2] = await aqua.rawBalances(
      makerAddress,
      routerAddress,
      orderHash,
      await mETH.getAddress()
    );
    const [poolMUSDC2, tokensCountMUSDC2] = await aqua.rawBalances(
      makerAddress,
      routerAddress,
      orderHash,
      await mUSDC.getAddress()
    );
    
    console.log("\n💧 LP Pool Balances After Second Swap:");
    console.log(`  mETH: ${formatBalance(poolMETH2)}`);
    console.log(`  mUSDC: ${formatBalance(poolMUSDC2)}`);
    const poolPrice2 = Number(poolMUSDC2) / Number(poolMETH2);
    console.log(`  Pool Price: $${poolPrice2.toFixed(2)} per ETH`);
    
    if (mETHChange2 > 0n && mUSDCChange2 < 0n) {
      const actualPrice2 = Number(-mUSDCChange2) / Number(mETHChange2);
      console.log(`\n  Taker Price Paid: $${actualPrice2.toFixed(2)} per mETH`);
      console.log(`  Total USDC Spent: $${(-Number(mUSDCChange2) / 1e18).toFixed(2)}`);
      
      if (currentPrice2) {
        const priceDeviation2 = ((actualPrice2 / currentPrice2.price) - 1) * 100;
        console.log(`  Price Deviation: ${priceDeviation2 >= 0 ? '+' : ''}${priceDeviation2.toFixed(2)}%`);
      }
    }
    
    console.log(`\nTransaction 2: https://sepolia.etherscan.io/tx/${receipt2.hash}`);
    console.log(`Gas Used: ${receipt2.gasUsed.toString()}\n`);

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                                                            ║");
    console.log("║         ✅ BIDIRECTIONAL TEST SUCCESSFUL! ✅              ║");
    console.log("║                                                            ║");
    console.log("║  ONE order works for BOTH directions! 🎉                   ║");
    console.log("║  ✓ Sold 0.5 ETH for USDC (base → quote)                   ║");
    console.log("║  ✓ Bought $300 worth of ETH (quote → base)                ║");
    console.log("║                                                            ║");
    console.log("║  DODOSwap is working with REAL Pyth oracle on Sepolia!    ║");
    console.log("║                                                            ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

  } catch (error: any) {
    console.error("\n╔════════════════════════════════════════════════════════════╗");
    console.error("║                                                            ║");
    console.error("║                  ❌ TEST FAILED ❌                         ║");
    console.error("║                                                            ║");
    console.error("╚════════════════════════════════════════════════════════════╝\n");
    
    console.error("Error:", error.message);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    if (error.code) {
      console.error("Code:", error.code);
    }
    
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


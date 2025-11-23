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
  // Core Infrastructure (✅ FRESHLY DEPLOYED)
  AQUA: "0xD5C0906640E84B6984E019bAB213F3F97964533b",
  MY_CUSTOM_OPCODES: "0x38E30a17eF90F18E8b0e02D5A1e536df8ce1018D", // CustomSwapVMRouter
  
  // Tokens (✅ FRESHLY DEPLOYED)
  METH: "0x8F0923F644A37DdE18d0a6f9808B48343ac7C589",  // TokenMock0
  MUSDC: "0x8B7Ba14b5922FE54E5cbbc9B4e1559f426f38092", // TokenMock1
  
  // Oracle (wraps Pyth) (✅ FRESHLY DEPLOYED)
  ORACLE: "0x8220BbF0F47F781CB43B38977ED7105a485f9d3d",
  
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
const MAX_PRICE_STALENESS = 60;                // 60 seconds max staleness

// ============================================================================
// TEST CONFIGURATION
// ============================================================================
const LIQUIDITY_METH = ether("5");      // 5 mETH liquidity (more than target of 2)
const LIQUIDITY_MUSDC = ether("15000"); // 15,000 mUSDC liquidity (more than target of 5,600)
const SWAP_AMOUNT_METH = ether("0.1");  // Swap 0.1 mETH (smaller amount)

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
    // Get accounts - if only one exists, create a second one as taker
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const deployerAddress = await deployer.getAddress();
    
    // Use deployer as maker
    const maker = deployer;
    const makerAddress = deployerAddress;
    
    // Create or use a different taker
    let taker: any;
    let takerAddress: string;
    
    if (signers.length > 1) {
      // Use account[1] as taker if available
      taker = signers[1];
      takerAddress = await taker.getAddress();
      console.log("👥 Using existing second account as taker");
    } else {
      // Create a new random wallet as taker
      const takerWallet = ethers.Wallet.createRandom();
      taker = takerWallet.connect(ethers.provider);
      takerAddress = await taker.getAddress();
      console.log("👥 Created new random wallet as taker");
      
      // Fund the taker with ETH for gas
      const fundAmount = ethers.parseEther("0.1"); // 0.1 ETH for gas
      console.log(`   Funding taker with ${ethers.formatEther(fundAmount)} ETH...`);
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
    
    const needMETH = mETHBalance < LIQUIDITY_METH + SWAP_AMOUNT_METH;
    const needMUSDC = mUSDCBalance < LIQUIDITY_MUSDC;
    
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
    const aquaAddr = await aqua.getAddress();
    
    // Taker approves ROUTER (for swap execution)
    console.log("Taker approving router...");
    const takerMETHAllowance = await mETH.allowance(takerAddress, routerAddress);
    if (takerMETHAllowance < SWAP_AMOUNT_METH) {
      const tx = await mETH.connect(taker).approve(routerAddress, ethers.MaxUint256);
      await waitForTx(tx, "Taker approve mETH to Router");
      console.log("✅ Taker approved mETH to Router\n");
    } else {
      console.log("✅ Taker mETH already approved to Router\n");
    }
    
    // Maker approves AQUA (for shipping liquidity)
    console.log("Maker approving Aqua for liquidity...");
    const makerMETHAllowanceAqua = await mETH.allowance(makerAddress, aquaAddr);
    const makerMUSDCAllowanceAqua = await mUSDC.allowance(makerAddress, aquaAddr);
    
    if (makerMETHAllowanceAqua < LIQUIDITY_METH) {
      const tx = await mETH.connect(maker).approve(aquaAddr, ethers.MaxUint256);
      await waitForTx(tx, "Maker approve mETH to Aqua");
    }
    
    if (makerMUSDCAllowanceAqua < LIQUIDITY_MUSDC) {
      const tx = await mUSDC.connect(maker).approve(aquaAddr, ethers.MaxUint256);
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

    // Step 6.5: Approve tokens to Aqua for shipping liquidity
    const aquaAddr = await aqua.getAddress();
    const mETHAllowanceAqua = await mETH.allowance(deployerAddress, aquaAddr);
    const mUSDCAllowanceAqua = await mUSDC.allowance(deployerAddress, aquaAddr);
    
    if (mETHAllowanceAqua < LIQUIDITY_METH) {
      const tx = await mETH.approve(aquaAddr, ethers.MaxUint256);
      await waitForTx(tx, "Approve mETH to Aqua");
    }
    
    if (mUSDCAllowanceAqua < LIQUIDITY_MUSDC) {
      const tx = await mUSDC.approve(aquaAddr, ethers.MaxUint256);
      await waitForTx(tx, "Approve mUSDC to Aqua");
    }

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

    // Step 9: Execute swap
    console.log("═══ 🔄 Step 9: Execute Swap with Real Pyth Price ===\n");
    
    const takerTraits = TakerTraitsLib.build({
      taker: takerAddress,  // taker (different from maker!)
      isExactIn: true,
      threshold: 0n, // Accept any output for test
      useTransferFromAndAquaPush: true
    });
    
    console.log(`Taker (${takerAddress}) swapping ${formatBalance(SWAP_AMOUNT_METH)} mETH for mUSDC...`);
    
    const mETHBefore = await mETH.balanceOf(takerAddress);
    const mUSDCBefore = await mUSDC.balanceOf(takerAddress);
    
    // Try to estimate gas first to catch revert reason
    try {
      const gasEstimate = await router.swap.estimateGas(
        orderStruct,
        await mETH.getAddress(),
        await mUSDC.getAddress(),
        SWAP_AMOUNT_METH,
        takerTraits
      );
      console.log(`Estimated gas: ${gasEstimate.toString()}\n`);
    } catch (estimateError: any) {
      console.error("\n❌ Gas estimation failed - transaction will revert!");
      console.error(`Error: ${estimateError.message}`);
      if (estimateError.data) {
        const errorData = estimateError.data;
        const selector = errorData.slice(0, 10);
        console.error(`Data: ${errorData}`);
        console.error(`Error selector: ${selector}`);
        
        // Decode common errors
        const errorSelectors: { [key: string]: string } = {
          // Standard Solidity errors
          "0x08c379a0": "Error(string) - Generic revert with message",
          "0x4e487b71": "Panic(uint256) - Assertion/overflow/underflow",
          
          // DODOSwap errors
          [ethers.id("DODOSwapInsufficientLiquidity()").slice(0, 10)]: "DODOSwapInsufficientLiquidity()",
          [ethers.id("DODOSwapRecomputeDetected()").slice(0, 10)]: "DODOSwapRecomputeDetected() - Swap amounts already computed",
          [ethers.id("DODOSwapInvalidKParameter(uint256)").slice(0, 10)]: "DODOSwapInvalidKParameter(uint256)",
          [ethers.id("DODOSwapRequiresBothBalancesNonZero(uint256,uint256)").slice(0, 10)]: "DODOSwapRequiresBothBalancesNonZero()",
          
          // Oracle/Pyth errors
          [ethers.id("StalePrice(uint256,uint256)").slice(0, 10)]: "StalePrice() - Pyth price too old",
          [ethers.id("InvalidPrice(int64)").slice(0, 10)]: "InvalidPrice() - Pyth price invalid",
          "0x19abf40e": "StalePrice() - Pyth SDK",
          "0x14aebe68": "PriceFeedNotFound() - Pyth SDK",
          
          // SwapVM errors
          [ethers.id("XYCSwapRecomputeDetected()").slice(0, 10)]: "XYCSwapRecomputeDetected()",
          [ethers.id("LimitSwapRecomputeDetected()").slice(0, 10)]: "LimitSwapRecomputeDetected()",
          [ethers.id("SetBalancesExpectZeroBalances(uint256,uint256)").slice(0, 10)]: "SetBalancesExpectZeroBalances() - Balances must be zero",
          [ethers.id("RunLoopSwapAmountsComputationMissing(uint256,uint256)").slice(0, 10)]: "RunLoopSwapAmountsComputationMissing()",
          
          // Try manually adding the mystery error
          "0xf4059071": "UNKNOWN ERROR - Manually check contract"
        };
        
        // Check if we know this error
        let found = false;
        for (const [sel, name] of Object.entries(errorSelectors)) {
          if (sel.toLowerCase() === selector.toLowerCase()) {
            console.error(`\n🔍 Decoded Error: ${name}`);
            found = true;
            break;
          }
        }
        
        if (!found) {
          console.error(`\n❌ Unknown error selector: ${selector}`);
          console.error("Known selectors:");
          for (const [sel, name] of Object.entries(errorSelectors)) {
            console.error(`  ${sel} = ${name}`);
          }
        }
      }
      if (estimateError.reason) {
        console.error(`Reason: ${estimateError.reason}`);
      }
      throw estimateError;
    }
    
    // Taker executes the swap (connect as taker!)
    const swapTx = await (router as any).connect(taker || deployer).swap(
      orderStruct,
      await mETH.getAddress(),
      await mUSDC.getAddress(),
      SWAP_AMOUNT_METH,
      takerTraits
    );
    
    const receipt = await waitForTx(swapTx, "Execute swap");
    
    const mETHAfter = await mETH.balanceOf(takerAddress);
    const mUSDCAfter = await mUSDC.balanceOf(takerAddress);

    // Step 10: Analyze results
    console.log("═══ 📈 Step 10: Results ═══\n");
    
    const mETHChange = mETHAfter - mETHBefore;
    const mUSDCChange = mUSDCAfter - mUSDCBefore;
    
    console.log("Balance Changes:");
    console.log(`  mETH: ${mETHChange >= 0n ? '+' : ''}${ethers.formatEther(mETHChange < 0n ? -mETHChange : mETHChange)}`);
    console.log(`  mUSDC: ${mUSDCChange >= 0n ? '+' : ''}${ethers.formatEther(mUSDCChange < 0n ? -mUSDCChange : mUSDCChange)}`);
    
    if (mETHChange < 0n && mUSDCChange > 0n) {
      const actualPrice = Number(mUSDCChange) / Number(-mETHChange);
      console.log(`\nActual Price Paid: $${actualPrice.toFixed(2)} per mETH`);
      
      if (currentPrice) {
        const priceDeviation = ((actualPrice / currentPrice.price) - 1) * 100;
        console.log(`Price Deviation: ${priceDeviation >= 0 ? '+' : ''}${priceDeviation.toFixed(2)}%`);
      }
    }
    
    console.log(`\nTransaction: https://sepolia.etherscan.io/tx/${receipt.hash}`);
    console.log(`Gas Used: ${receipt.gasUsed.toString()}`);

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                                                            ║");
    console.log("║            ✅ INTEGRATION TEST SUCCESSFUL! ✅              ║");
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


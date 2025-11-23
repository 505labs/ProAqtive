// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to get a quote for a swap
 * 
 * Usage:
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=order.json npx hardhat run scripts/get-quote.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, formatTokenAmount, parseTokenAmount, getDeployedAddress } from "./utils/helpers";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { TakerTraitsLib } from "../test/utils/SwapVMHelpers";
// IERC20 interface - using ethers.getContractAt instead of importing
import * as fs from "fs";
import { getQuote } from "./utils/get-quote";

const DEFAULT_TOKEN0_ADDRESS = "0x6105E77Cd7942c4386C01d1F0B9DD7876141c549";  // Mock ETH
const DEFAULT_TOKEN1_ADDRESS = "0x5aA57352bF243230Ce55dFDa70ba9c3A253432f6";  // Mock USDC



async function main() {
    console.log("=== Getting Swap Quote ===\n");

    // Get signers
    const [signer] = await ethers.getSigners();
    const takerAddress = process.env.TAKER_ADDRESS || await signer.getAddress();
    console.log(`Taker address: ${takerAddress}\n`);

    // Get deployed contracts
    const swapVM = await getDeployedContract<CustomSwapVMRouter>("CustomSwapVMRouter");
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");
    const aqua = await getDeployedContract<Aqua>("Aqua");

    // Get token addresses
    const tokenInAddress = process.env.TOKEN_IN || DEFAULT_TOKEN0_ADDRESS;
    const tokenOutAddress = process.env.TOKEN_OUT || DEFAULT_TOKEN1_ADDRESS;

    if (!tokenInAddress || !tokenOutAddress) {
        throw new Error("TOKEN_IN and TOKEN_OUT environment variables are required");
    }

    // Get amount
    const amountIn = parseTokenAmount(process.env.AMOUNT_IN || "10");
    const isExactIn = process.env.IS_EXACT_IN !== "false"; // Default: true

    console.log("Quote Configuration:");
    console.log(`  Token In: ${tokenInAddress}`);
    console.log(`  Token Out: ${tokenOutAddress}`);
    console.log(`  Amount: ${formatTokenAmount(amountIn)}`);
    console.log(`  Type: ${isExactIn ? "Exact In" : "Exact Out"}\n`);

    // Build or load order
    let order;
    const orderFilePath = process.env.ORDER_FILE || "order.json";
    if (orderFilePath && fs.existsSync(orderFilePath)) {
        console.log(`📂 Loading order from ${orderFilePath}...`);
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
        order = {
            maker: orderData.maker,
            traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : BigInt(orderData.traits),
            data: orderData.data
        };
    } else {
        console.log("🔨 Building new order...");
        const makerAddress = process.env.MAKER_ADDRESS || takerAddress;

        // Try to auto-detect MockPyth if not provided (must match ship-liquidity.ts)
        let pythOracle = process.env.PYTH_ORACLE;
        if (!pythOracle || pythOracle === "0x0000000000000000000000000000000000000000") {
            try {
                const mockPythAddress = await getDeployedAddress("MockPyth");
                if (mockPythAddress && mockPythAddress !== "") {
                    console.log(`   📍 Auto-detected MockPyth: ${mockPythAddress}`);
                    pythOracle = mockPythAddress;
                } else {
                    pythOracle = "0x0000000000000000000000000000000000000000";
                    console.log("   ⚠️  PYTH_ORACLE not set and MockPyth not found");
                    console.log("   💡 Deploy MockPyth first: npx hardhat deploy --tags MockPyth --network sepolia");
                }
            } catch (e) {
                pythOracle = "0x0000000000000000000000000000000000000000";
            }
        }

        const priceId = process.env.PRICE_ID || ethers.id("TEST_PRICE_ID");
        const k = process.env.K ? BigInt(process.env.K) : 400000000000000000n;
        const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : 3600n;
        const isTokenInBase = process.env.IS_TOKEN_IN_BASE !== "false";
        const baseDecimals = parseInt(process.env.BASE_DECIMALS || "18");
        const quoteDecimals = parseInt(process.env.QUOTE_DECIMALS || "18");

        if (pythOracle === "0x0000000000000000000000000000000000000000") {
            console.error("\n❌ ERROR: PYTH_ORACLE is zero address!");
            console.error("   ProAquativeMM requires a valid Pyth oracle address.");
            console.error("\n   Solutions:");
            console.error("   1. Deploy MockPyth: npx hardhat deploy --tags MockPyth --network sepolia");
            console.error("   2. Set PYTH_ORACLE env var: PYTH_ORACLE=0x... npx hardhat run scripts/get-quote.ts --network sepolia");
            console.error("   3. Use ORDER_FILE to load the order used when shipping liquidity");
            throw new Error("PYTH_ORACLE must be set to a valid address");
        }

        const orderResult = await proAquativeAMM.buildProgram(
            makerAddress,
            pythOracle,
            priceId,
            k,
            maxStaleness,
            isTokenInBase,
            baseDecimals,
            quoteDecimals
        );

        order = {
            maker: orderResult.maker,
            traits: orderResult.traits,
            data: orderResult.data
        };
    }

    // Get quote using the extracted function
    console.log("\n🔍 Checking liquidity status...");
    const quoteResult = await getQuote({
        swapVM,
        proAquativeAMM,
        aqua,
        tokenInAddress,
        tokenOutAddress,
        amountIn,
        order: order,
        takerAddress,
        isExactIn,
        threshold: process.env.THRESHOLD ? BigInt(process.env.THRESHOLD) : 0n,
        checkLiquidity: true,
        checkOracle: true
    });

    if (quoteResult.success) {
        console.log("\n✅ Quote received!");
        console.log(`   Input: ${formatTokenAmount(amountIn)}`);
        console.log(`   Output: ${formatTokenAmount(quoteResult.amountOut)}`);
        console.log(`   Order Hash: ${quoteResult.orderHash}`);

        if (amountIn > 0n) {
            const rate = (Number(quoteResult.amountOut) / Number(amountIn)).toFixed(6);
            console.log(`   exchange Rate: 1 TokenIn = ${rate} TokenOut`);
        }
    } else {
        console.error("\n❌ Failed to get quote:");
        console.error(`   Error: ${quoteResult.error || "Unknown error"}`);

        console.log("\n🔍 Troubleshooting:");

        // Check if error is "Price too stale"
        const errorMessage = quoteResult.error || "";
        if (errorMessage.includes("stale") || errorMessage.includes("Price too stale")) {
            console.log("   ⚠️  ERROR: Price is too stale!");
            console.log("   💡 The Pyth oracle price is older than maxStaleness");
            console.log("\n   Solutions:");
            console.log("   1. Update the price in MockPyth:");
            console.log("      npx hardhat run scripts/update-pyth-price.ts --network sepolia");
            console.log("   2. Or manually update via contract:");
            console.log("      - Get MockPyth address: npx hardhat run scripts/check-balances.ts --network sepolia");
            console.log("      - Call setPrice() with current timestamp");
            console.log("   3. Or increase maxStaleness when building order:");
            console.log("      MAX_STALENESS=7200 npx hardhat run scripts/build-order.ts --network sepolia");
            console.log("");
        }

        console.log("  1. Check if liquidity has been shipped:");
        console.log("     - Run: npx hardhat run scripts/ship-liquidity.ts --network sepolia");
        console.log("  2. Verify the order matches the shipped liquidity:");
        console.log("     - Order hash must match the one used when shipping");
        console.log("  3. Check token addresses are correct:");
        console.log(`     - TokenIn: ${tokenInAddress}`);
        console.log(`     - TokenOut: ${tokenOutAddress}`);
        console.log("  4. For ProAquativeMM, verify oracle has fresh price:");
        console.log("     - Check MockPyth has price for the PRICE_ID");
        console.log("     - Price must be newer than maxStaleness");
        console.log("  5. Check if amount is too large for available liquidity");
    }

    console.log("quoteResult", quoteResult);
    return quoteResult;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


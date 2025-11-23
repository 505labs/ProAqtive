// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to execute a swap using ProAquativeAMM
 * 
 * Usage:
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=order.json npx hardhat run scripts/execute-swap.ts --network sepolia
 * 
 * Or build order on the fly:
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 PYTH_ORACLE=0x... npx hardhat run scripts/execute-swap.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, waitForTx, displayBalance, parseTokenAmount, formatTokenAmount } from "./utils/helpers";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
// IERC20 interface - using ethers.getContractAt instead of importing
import * as fs from "fs";
import * as path from "path";
import { getQuote } from "./utils/get-quote";

const DEFAULT_TOKEN0_ADDRESS = "0x6105E77Cd7942c4386C01d1F0B9DD7876141c549";  // Mock ETH
const DEFAULT_TOKEN1_ADDRESS = "0x5aA57352bF243230Ce55dFDa70ba9c3A253432f6";  // Mock USDC

async function main() {
    console.log("=== Executing Swap ===\n");

    // Get signers
    const [taker] = await ethers.getSigners();
    const takerAddress = await taker.getAddress();
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

    const tokenIn = await ethers.getContractAt("IERC20", tokenInAddress) as any;
    const tokenOut = await ethers.getContractAt("IERC20", tokenOutAddress) as any;

    // Get amount
    const amountIn = parseTokenAmount(process.env.AMOUNT_IN || "10");
    const threshold = process.env.THRESHOLD ? parseTokenAmount(process.env.THRESHOLD) : 0n;

    console.log("Swap Configuration:");
    console.log(`  Token In: ${tokenInAddress}`);
    console.log(`  Token Out: ${tokenOutAddress}`);
    console.log(`  Amount In: ${formatTokenAmount(amountIn)}`);
    console.log(`  Min Output (threshold): ${formatTokenAmount(threshold)}\n`);

    // Check balances before
    console.log("Balances before swap:");
    await displayBalance(tokenIn, takerAddress, "TokenIn balance");
    await displayBalance(tokenOut, takerAddress, "TokenOut balance");

    // Build or load order
    let order;
    const orderFilePath = process.env.ORDER_FILE || "order.json"; // Default to order.json like get-quote.ts
    if (orderFilePath && fs.existsSync(orderFilePath)) {
        console.log(`\n📂 Loading order from ${orderFilePath}...`);
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
        order = {
            maker: orderData.maker,
            traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : BigInt(orderData.traits),
            data: orderData.data
        };
    } else {
        console.log("\n🔨 Building new order...");
        const makerAddress = process.env.MAKER_ADDRESS || takerAddress; // Use taker as maker if not specified

        // Try to auto-detect MockPyth if not provided (must match get-quote.ts and ship-liquidity.ts)
        let pythOracle = process.env.PYTH_ORACLE;
        if (!pythOracle || pythOracle === "0x0000000000000000000000000000000000000000") {
            try {
                const { getDeployedAddress } = await import("./utils/helpers");
                const mockPythAddress = await getDeployedAddress("MockPyth");
                if (mockPythAddress && mockPythAddress !== "") {
                    console.log(`   📍 Auto-detected MockPyth: ${mockPythAddress}`);
                    pythOracle = mockPythAddress;
                } else {
                    pythOracle = "0x0000000000000000000000000000000000000000";
                    console.log("   ⚠️  PYTH_ORACLE not set and MockPyth not found");
                    console.log("   💡 Deploy MockPyth first: npx hardhat deploy --tags MockPyth --network sepolia");
                }
            } catch (e: any) {
                pythOracle = "0x0000000000000000000000000000000000000000";
                console.log(`   ⚠️  Error during MockPyth auto-detection: ${e.message || e}`);
            }
        } else {
            console.log(`   ✅ Using provided PYTH_ORACLE: ${pythOracle}`);
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
            console.error("   2. Set PYTH_ORACLE env var: PYTH_ORACLE=0x... npx hardhat run scripts/execute-swap.ts --network sepolia");
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

    // Log order details for debugging
    console.log("\n📋 Order Details:");
    console.log(`   Maker: ${order.maker}`);
    console.log(`   Traits: ${order.traits.toString()}`);
    console.log(`   Data length: ${order.data.length} bytes`);
    console.log(`   Data (hex, first 100 chars): ${order.data.slice(0, 100)}...`);

    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

    // Calculate order hash for comparison
    const orderHashBeforeQuote = await swapVM.hash(orderStruct);
    console.log(`\n   Order Hash (calculated in execute-swap): ${orderHashBeforeQuote}`);

    // Also log the raw order data to help debug
    console.log(`   Order data (full hex): ${order.data}`);

    // Check allowance
    const allowance = await tokenIn.allowance(takerAddress, await swapVM.getAddress());
    if (allowance < amountIn) {
        console.log("\n⚠️  Allowance insufficient, approving...");
        const approveTx = await tokenIn.connect(taker).approve(await swapVM.getAddress(), ethers.MaxUint256);
        await waitForTx(approveTx, "Approve TokenIn");
    }

    // Get quote first (required before swap)
    console.log("\n📊 Getting quote...");
    const quoteResult = await getQuote({
        swapVM,
        proAquativeAMM,
        aqua,
        tokenInAddress,
        tokenOutAddress,
        amountIn,
        order: order,
        takerAddress,
        isExactIn: true,
        threshold: threshold,
        checkLiquidity: true,
        checkOracle: true
    });



    // Compare order hashes
    console.log(`\n   Order Hash (from getQuote): ${quoteResult.orderHash}`);
    if (orderHashBeforeQuote !== quoteResult.orderHash && quoteResult.success) {
        console.error(`\n   ⚠️  WARNING: Order hash mismatch!`);
        console.error(`      Before getQuote: ${orderHashBeforeQuote}`);
        console.error(`      From getQuote: ${quoteResult.orderHash}`);
        console.error(`   💡 This indicates the order used in getQuote is different from the one in execute-swap`);
        console.error(`   💡 This will cause the swap to fail!`);
    } else if (quoteResult.success) {
        console.log(`   ✅ Order hashes match!`);
    }

    if (!quoteResult.success) {
        console.error("  ❌ Failed to get quote:");
        console.error(`     Error: ${quoteResult.error || "Unknown error"}`);

        console.log("\n  🔍 Troubleshooting:");

        // Check if error is "Price too stale"
        const errorMessage = quoteResult.error || "";
        if (errorMessage.includes("stale") || errorMessage.includes("Price too stale")) {
            console.log("     ⚠️  ERROR: Price is too stale!");
            console.log("     💡 The Pyth oracle price is older than maxStaleness");
            console.log("\n     Solutions:");
            console.log("     1. Update the price in MockPyth:");
            console.log("        npx hardhat run scripts/update-pyth-price.ts --network sepolia");
            console.log("     2. Or increase maxStaleness when building order:");
            console.log("        MAX_STALENESS=7200 npx hardhat run scripts/build-order.ts --network sepolia");
            console.log("");
        }

        console.log("     1. Check if liquidity has been shipped:");
        console.log("        - Run: npx hardhat run scripts/ship-liquidity.ts --network sepolia");
        console.log("     2. Verify the order matches the shipped liquidity:");
        console.log("        - Use ORDER_FILE to ensure same order");
        console.log("     3. Check oracle has fresh price:");
        console.log("        - Run: npx hardhat run scripts/update-pyth-price.ts --network sepolia");
        console.log("     4. Verify token addresses are correct:");
        console.log(`        - TokenIn: ${tokenInAddress}`);
        console.log(`        - TokenOut: ${tokenOutAddress}`);

        console.log("\n  ❌ Cannot proceed with swap - quote failed");
        throw new Error(`Quote failed: ${quoteResult.error || "Unknown error"}`);
    }

    const expectedAmountOut = quoteResult.amountOut;
    console.log(`  ✅ Quote received!`);
    console.log(`     Expected input: ${formatTokenAmount(quoteResult.amountIn)}`);
    console.log(`     Expected output: ${formatTokenAmount(expectedAmountOut)}`);
    console.log(`     Order Hash: ${quoteResult.orderHash}`);

    if (expectedAmountOut < threshold && threshold > 0n) {
        console.log(`  ⚠️  WARNING: Expected output (${formatTokenAmount(expectedAmountOut)}) is below threshold (${formatTokenAmount(threshold)})`);
        console.log(`  💡 Swap will revert if executed with this threshold`);
    }

    // Build taker data for swap
    const { TakerTraitsLib } = await import("../test/utils/SwapVMHelpers");
    const takerData = TakerTraitsLib.build({
        taker: takerAddress,
        isExactIn: true,
        threshold: threshold,
        useTransferFromAndAquaPush: true
    });

    // Execute swap - use the same orderStruct that was used for getQuote
    // IMPORTANT: Use the orderHash from quoteResult to ensure consistency
    console.log("\n🔄 Executing swap...");
    console.log(`   Using order hash: ${quoteResult.orderHash}`);

    // Verify orderStruct matches what was used in getQuote
    const orderHashForSwap = await swapVM.hash(orderStruct);
    if (orderHashForSwap !== quoteResult.orderHash) {
        console.error(`\n   ⚠️  CRITICAL: Order hash mismatch before swap!`);
        console.error(`      Expected (from quote): ${quoteResult.orderHash}`);
        console.error(`      Actual (from orderStruct): ${orderHashForSwap}`);
        console.error(`   💡 The swap will fail because the order hash doesn't match the one used in the quote`);
        throw new Error(`Order hash mismatch: expected ${quoteResult.orderHash}, got ${orderHashForSwap}`);
    }

    try {
        const swapTx = await swapVM.connect(taker).swap(
            orderStruct,
            tokenInAddress,
            tokenOutAddress,
            amountIn,
            takerData
        );

        const receipt = await waitForTx(swapTx, "Execute swap");

        // Check balances after
        console.log("\nBalances after swap:");
        await displayBalance(tokenIn, takerAddress, "TokenIn balance");
        await displayBalance(tokenOut, takerAddress, "TokenOut balance");

        // Try to parse swap event if available
        console.log("\n✅ Swap executed successfully!");
        console.log(`   Transaction: ${receipt.hash}`);
        console.log(`   Block: ${receipt.blockNumber}`);
    } catch (error: any) {
        console.error("\n❌ Failed to execute swap:");

        // Try to extract detailed error information
        if (error.reason) {
            console.error(`   Reason: ${error.reason}`);
        }
        if (error.data) {
            console.error(`   Data: ${error.data}`);
        }
        if (error.error) {
            console.error(`   Error: ${error.error.message || error.error}`);
        }
        console.error(`   Message: ${error.message || error}`);

        console.log("\n🔍 Troubleshooting:");

        // Check if error is "Price too stale"
        const errorMessage = error.message || error.toString() || "";
        if (errorMessage.includes("stale") || errorMessage.includes("Price too stale")) {
            console.log("   ⚠️  ERROR: Price is too stale!");
            console.log("   💡 The Pyth oracle price is older than maxStaleness");
            console.log("\n   Solutions:");
            console.log("   1. Update the price in MockPyth:");
            console.log("      npx hardhat run scripts/update-pyth-price.ts --network sepolia");
            console.log("   2. Or increase maxStaleness when building order:");
            console.log("      MAX_STALENESS=7200 npx hardhat run scripts/build-order.ts --network sepolia");
            console.log("");
        }

        console.log("  1. Check if liquidity has been shipped:");
        console.log("     - Run: npx hardhat run scripts/ship-liquidity.ts --network sepolia");
        console.log("  2. Verify the order matches the shipped liquidity:");
        console.log("     - Use ORDER_FILE to ensure same order");
        console.log("  3. Check token addresses are correct:");
        console.log(`     - TokenIn: ${tokenInAddress}`);
        console.log(`     - TokenOut: ${tokenOutAddress}`);
        console.log("  4. Verify oracle has fresh price:");
        console.log("     - Run: npx hardhat run scripts/update-pyth-price.ts --network sepolia");
        console.log("  5. Check if amount is too large for available liquidity");
        console.log("  6. Verify token approvals:");
        console.log(`     - TokenIn approved to: ${await swapVM.getAddress()}`);

        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


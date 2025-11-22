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
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20";
import * as fs from "fs";
import * as path from "path";
import { TakerTraitsLib } from "../test/utils/SwapVMHelpers";

async function main() {
    console.log("=== Executing Swap ===\n");

    // Get signers
    const [taker] = await ethers.getSigners();
    const takerAddress = await taker.getAddress();
    console.log(`Taker address: ${takerAddress}\n`);

    // Get deployed contracts
    const swapVM = await getDeployedContract<CustomSwapVMRouter>("CustomSwapVMRouter");
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");

    // Get token addresses
    const tokenInAddress = process.env.TOKEN_IN || process.env.TOKEN_IN_ADDRESS;
    const tokenOutAddress = process.env.TOKEN_OUT || process.env.TOKEN_OUT_ADDRESS;

    if (!tokenInAddress || !tokenOutAddress) {
        throw new Error("TOKEN_IN and TOKEN_OUT environment variables are required");
    }

    const tokenIn = await ethers.getContractAt("IERC20", tokenInAddress);
    const tokenOut = await ethers.getContractAt("IERC20", tokenOutAddress);

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
    const orderFilePath = process.env.ORDER_FILE;
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
        const pythOracle = process.env.PYTH_ORACLE || "0x0000000000000000000000000000000000000000";
        const priceId = process.env.PRICE_ID || ethers.id("TEST_PRICE_ID");
        const k = process.env.K ? BigInt(process.env.K) : 500000000000000000n;
        const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : 3600n;
        const isTokenInBase = process.env.IS_TOKEN_IN_BASE !== "false";
        const baseDecimals = parseInt(process.env.BASE_DECIMALS || "18");
        const quoteDecimals = parseInt(process.env.QUOTE_DECIMALS || "18");

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

    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

    // Check allowance
    const allowance = await tokenIn.allowance(takerAddress, await swapVM.getAddress());
    if (allowance < amountIn) {
        console.log("\n⚠️  Allowance insufficient, approving...");
        const approveTx = await tokenIn.connect(taker).approve(await swapVM.getAddress(), ethers.MaxUint256);
        await waitForTx(approveTx, "Approve TokenIn");
    }

    // Build taker data
    const takerData = TakerTraitsLib.build({
        taker: takerAddress,
        isExactIn: true,
        threshold: threshold,
        useTransferFromAndAquaPush: true
    });

    // Get quote first
    console.log("\n📊 Getting quote...");
    try {
        const quote = await swapVM.quote(
            orderStruct,
            tokenInAddress,
            tokenOutAddress,
            amountIn
        );
        console.log(`  Expected output: ${formatTokenAmount(quote)}`);
    } catch (error) {
        console.log("  ⚠️  Could not get quote (may need liquidity shipped first)");
    }

    // Execute swap
    console.log("\n🔄 Executing swap...");
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
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


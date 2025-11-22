// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to get a quote for a swap
 * 
 * Usage:
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=order.json npx hardhat run scripts/get-quote.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, formatTokenAmount, parseTokenAmount } from "./utils/helpers";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { TakerTraitsLib } from "../test/utils/SwapVMHelpers";
import * as fs from "fs";

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
    const orderFilePath = process.env.ORDER_FILE;
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

    // Build taker data
    const threshold = process.env.THRESHOLD ? BigInt(process.env.THRESHOLD) : 0n;
    const takerData = TakerTraitsLib.build({
        taker: takerAddress,
        isExactIn: isExactIn,
        threshold: threshold,
        useTransferFromAndAquaPush: true
    });

    // Get quote
    console.log("\n📊 Getting quote...");
    try {
        // quote returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)
        // Use staticCall for view functions in ethers v6
        const quoteResult = await swapVM.quote.staticCall(
            orderStruct,
            tokenInAddress,
            tokenOutAddress,
            amountIn,
            takerData
        );

        // Destructure the tuple result
        const amountInResult: bigint = quoteResult[0];
        const amountOut: bigint = quoteResult[1];
        const orderHash: string = quoteResult[2];

        console.log("\n✅ Quote received!");
        console.log(`   Input: ${formatTokenAmount(amountIn)}`);
        console.log(`   Output: ${formatTokenAmount(amountOut)}`);
        console.log(`   Order Hash: ${orderHash}`);

        if (amountIn > 0n) {
            const rate = (Number(amountOut) / Number(amountIn)).toFixed(6);
            console.log(`   Exchange Rate: 1 TokenIn = ${rate} TokenOut`);
        }
    } catch (error: any) {
        console.error("\n❌ Failed to get quote:");
        console.error(`   ${error.message || error}`);
        console.log("\nPossible reasons:");
        console.log("  - Liquidity not shipped yet");
        console.log("  - Order doesn't match shipped liquidity");
        console.log("  - Insufficient liquidity for this amount");
        console.log("  - Price oracle issue (for ProAquativeMM)");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


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
        const k = process.env.K ? BigInt(process.env.K) : 500000000000000000n;
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

    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

    // Check if liquidity has been shipped
    console.log("\n🔍 Checking liquidity status...");
    try {
        const orderHash = await swapVM.hash(orderStruct);
        const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(address maker, uint256 traits, bytes data)"],
            [orderStruct]
        );

        // Check Aqua balance for this order
        const tokenIn = await ethers.getContractAt("IERC20", tokenInAddress);
        const tokenOut = await ethers.getContractAt("IERC20", tokenOutAddress);

        const aquaAddress = await aqua.getAddress();
        const balanceIn = await tokenIn.balanceOf(aquaAddress);
        const balanceOut = await tokenOut.balanceOf(aquaAddress);

        console.log(`   Order Hash: ${orderHash}`);
        console.log(`   Aqua TokenIn balance: ${formatTokenAmount(balanceIn)}`);
        console.log(`   Aqua TokenOut balance: ${formatTokenAmount(balanceOut)}`);

        if (balanceIn === 0n && balanceOut === 0n) {
            console.log("   ⚠️  No liquidity found in Aqua for these tokens");
            console.log("   💡 Tip: Use 'ship-liquidity.ts' to deposit tokens first");
            console.log("   ⚠️  IMPORTANT: Make sure you use the SAME order when shipping and getting quotes!");
            console.log("   💡 Solution: Use ORDER_FILE to load the order from ship-liquidity.ts");
            console.log("      Example: ORDER_FILE=order.json npx hardhat run scripts/get-quote.ts --network sepolia");
        }
    } catch (checkError: any) {
        console.log(`   ⚠️  Could not check liquidity: ${checkError.message}`);
    }

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

        // Try to extract more detailed error information
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
        console.log("  1. Check if liquidity has been shipped:");
        console.log("     - Run: npx hardhat run scripts/ship-liquidity.ts --network sepolia");
        console.log("  2. Verify the order matches the shipped liquidity:");
        console.log("     - Order hash must match the one used when shipping");
        console.log("  3. Check token addresses are correct:");
        console.log(`     - TokenIn: ${tokenInAddress}`);
        console.log(`     - TokenOut: ${tokenOutAddress}`);
        console.log("  4. For ProAquativeMM, verify oracle has price set:");
        console.log("     - Check MockPyth has price for the PRICE_ID");
        console.log("  5. Check if amount is too large for available liquidity");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


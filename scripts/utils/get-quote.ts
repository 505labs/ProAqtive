// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to get a quote for a swap
 * 
 * Usage:
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=order.json npx hardhat run scripts/get-quote.ts --network sepolia
 */

import { ethers } from "hardhat";
import { formatTokenAmount, getDeployedAddress } from "./helpers";
import { CustomSwapVMRouter } from "../../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../../typechain-types/contracts/ProAquativeAMM";
import { Aqua } from "../../typechain-types/@1inch/aqua/src/Aqua";
import { TakerTraitsLib } from "../../test/utils/SwapVMHelpers";
// IERC20 interface - using ethers.getContractAt instead of importing
import * as fs from "fs";

export interface GetQuoteParams {
    swapVM: CustomSwapVMRouter;
    proAquativeAMM: ProAquativeAMM;
    aqua: Aqua;
    tokenInAddress: string;
    tokenOutAddress: string;
    amountIn: bigint;
    order?: {
        maker: string;
        traits: bigint;
        data: string;
    };
    orderFilePath?: string;
    takerAddress: string;
    isExactIn?: boolean;
    threshold?: bigint;
    checkLiquidity?: boolean;
    checkOracle?: boolean;
}

export interface GetQuoteResult {
    success: boolean;
    amountIn: bigint;
    amountOut: bigint;
    orderHash: string;
    error?: string;
}

/**
 * Get a quote for a swap
 * @param params Parameters for getting the quote
 * @returns Quote result with success status and amounts
 */
export async function getQuote(params: GetQuoteParams): Promise<GetQuoteResult> {
    const {
        swapVM,
        proAquativeAMM,
        aqua,
        tokenInAddress,
        tokenOutAddress,
        amountIn,
        order: providedOrder,
        orderFilePath,
        takerAddress,
        isExactIn = true,
        threshold = 0n,
        checkLiquidity = true,
        checkOracle = true
    } = params;

    // Build or load order
    let order;
    if (providedOrder) {
        order = providedOrder;
    } else if (orderFilePath && fs.existsSync(orderFilePath)) {
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
        order = {
            maker: orderData.maker,
            traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : BigInt(orderData.traits),
            data: orderData.data
        };
    } else {
        // Build new order - this requires additional parameters
        throw new Error("Either 'order' or 'orderFilePath' must be provided, or build order separately");
    }

    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

    // Calculate order hash for debugging
    const orderHashInGetQuote = await swapVM.hash(orderStruct);

    // Check liquidity if requested
    if (checkLiquidity) {
        try {
            const orderHash = await swapVM.hash(orderStruct);
            const swapVMAddress = await swapVM.getAddress();
            const makerAddress = order.maker;

            const [balanceInRaw, tokensCountIn] = await aqua.rawBalances(
                makerAddress,
                swapVMAddress,
                orderHash,
                tokenInAddress
            );
            const [balanceOutRaw, tokensCountOut] = await aqua.rawBalances(
                makerAddress,
                swapVMAddress,
                orderHash,
                tokenOutAddress
            );

            const balanceIn = BigInt(balanceInRaw);
            const balanceOut = BigInt(balanceOutRaw);
            const DOCKED = 255;

            const tokensCountInNum = Number(tokensCountIn);
            const tokensCountOutNum = Number(tokensCountOut);

            console.log(`   Order Hash: ${orderHash}`);
            console.log(`   Strategy TokenIn balance: ${formatTokenAmount(balanceIn)} (tokensCount: ${tokensCountInNum})`);
            console.log(`   Strategy TokenOut balance: ${formatTokenAmount(balanceOut)} (tokensCount: ${tokensCountOutNum})`);

            const strategyExists = tokensCountInNum > 0 || tokensCountOutNum > 0;
            const isDocked = tokensCountInNum === DOCKED || tokensCountOutNum === DOCKED;
            const hasLiquidity = balanceIn > 0n || balanceOut > 0n;

            if (!strategyExists) {
                console.log("   ⚠️  Strategy not found in Aqua");
                console.log("   💡 Tip: Use 'ship-liquidity.ts' to ship liquidity first");
            } else if (isDocked) {
                console.log("   ⚠️  Strategy is docked (closed)");
                console.log("   💡 Tip: Strategy was closed and cannot be used for swaps");
            } else if (!hasLiquidity) {
                console.log("   ⚠️  Strategy exists but has no liquidity");
                console.log("   💡 Tip: Liquidity may have been withdrawn or used");
            } else {
                console.log("   ✅ Strategy found with available liquidity");
            }

            // Check oracle price staleness if requested
            if (checkOracle) {
                try {
                    let pythOracle = process.env.PYTH_ORACLE;
                    if (!pythOracle || pythOracle === "0x0000000000000000000000000000000000000000") {
                        pythOracle = await getDeployedAddress("MockPyth");
                    }

                    if (pythOracle && pythOracle !== "" && pythOracle !== "0x0000000000000000000000000000000000000000") {
                        const priceId = process.env.PRICE_ID || ethers.id("TEST_PRICE_ID");
                        const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : 3600n;

                        const mockPyth = await ethers.getContractAt("MockPyth", pythOracle);
                        const priceData = await mockPyth.prices(priceId);
                        const currentTime = BigInt(Math.floor(Date.now() / 1000));
                        const publishTime = BigInt(priceData.publishTime.toString());
                        const age = currentTime - publishTime;

                        console.log(`\n   📊 Oracle Price Status:`);
                        console.log(`      Oracle: ${pythOracle}`);
                        console.log(`      Price ID: ${priceId}`);
                        console.log(`      Price: ${priceData.price.toString()} (exponent: ${priceData.expo.toString()})`);
                        console.log(`      Published: ${publishTime.toString()} (${new Date(Number(publishTime) * 1000).toISOString()})`);
                        console.log(`      Current Time: ${currentTime.toString()} (${new Date().toISOString()})`);
                        console.log(`      Age: ${age.toString()} seconds (${Number(age) / 60} minutes)`);
                        console.log(`      Max Staleness: ${maxStaleness.toString()} seconds (${Number(maxStaleness) / 60} minutes)`);

                        if (age > maxStaleness) {
                            console.log(`\n   ⚠️  WARNING: Price is STALE!`);
                            console.log(`      Age (${age}s) exceeds maxStaleness (${maxStaleness}s)`);
                            console.log(`      Difference: ${age - maxStaleness} seconds`);
                            console.log(`\n   💡 Solution: Update the price in MockPyth:`);
                            console.log(`      npx hardhat run scripts/update-pyth-price.ts --network sepolia`);
                        } else {
                            console.log(`      ✅ Price is fresh (within maxStaleness)`);
                        }
                    }
                } catch (oracleError: any) {
                    // Ignore oracle check errors
                    console.log(`   ⚠️  Could not check oracle price: ${oracleError.message || oracleError}`);
                }
            }
        } catch (checkError: any) {
            // Ignore check errors
            console.log(`   ⚠️  Could not check liquidity: ${checkError.message || checkError}`);
        }
    }

    // Build taker data
    const takerData = TakerTraitsLib.build({
        taker: takerAddress,
        isExactIn: isExactIn,
        threshold: threshold,
        useTransferFromAndAquaPush: true
    });

    // Get quote
    try {
        const quoteResult = await swapVM.quote.staticCall(
            orderStruct,
            tokenInAddress,
            tokenOutAddress,
            amountIn,
            takerData
        );

        const amountInResult: bigint = quoteResult[0];
        const amountOut: bigint = quoteResult[1];
        const orderHashFromQuote: string = quoteResult[2];

        // Verify the order hash from quote matches what we calculated
        if (orderHashInGetQuote !== orderHashFromQuote) {
            console.warn(`   ⚠️  WARNING: Order hash mismatch in getQuote!`);
            console.warn(`      Calculated: ${orderHashInGetQuote}`);
            console.warn(`      From quote: ${orderHashFromQuote}`);
        }

        return {
            success: true,
            amountIn: amountInResult,
            amountOut: amountOut,
            orderHash: orderHashFromQuote // Use the hash from quote result
        };
    } catch (error: any) {
        const errorMessage = error.message || error.toString() || "";
        return {
            success: false,
            amountIn: 0n,
            amountOut: 0n,
            orderHash: "",
            error: errorMessage
        };
    }
}
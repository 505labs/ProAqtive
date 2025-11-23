// SPDX-License-Identifier: Apache-2.0

/**
 * Script to execute a swap with Pyth oracle price update
 * This script:
 * 1. Fetches latest price update from Hermes API
 * 2. Updates the oracle with fresh price data
 * 3. Executes the swap using DODOSwap
 * 
 * Usage:
 *   npx hardhat run scripts/execute-swap-with-oracle.ts --network sepolia
 * 
 * Environment variables:
 *   ORACLE_ADDRESS - Address of the Oracle contract
 *   PRICE_ID - Pyth price feed ID
 *   TOKEN0_ADDRESS - Input token address
 *   TOKEN1_ADDRESS - Output token address
 *   SWAP_AMOUNT - Amount to swap
 *   MIN_AMOUNT_OUT - Minimum output amount (slippage protection)
 */

import { ethers } from "hardhat";
import axios from "axios";

const HERMES_API_URL = process.env.HERMES_URL || "https://hermes.pyth.network";

interface HermesResponse {
    binary: {
        data: string[];
    };
}

/**
 * Fetch and update oracle price
 */
async function updateOraclePrice(oracleAddress: string, priceId: string) {
    console.log(`\n📡 Fetching price update from Hermes API...`);
    
    try {
        // Fetch price update
        const response = await axios.get<HermesResponse>(
            `${HERMES_API_URL}/v2/updates/price/latest`,
            {
                params: {
                    ids: [priceId],
                    encoding: "hex",
                    parsed: true
                }
            }
        );

        const updateData = response.data.binary.data.map((hex: string) => 
            hex.startsWith('0x') ? hex : `0x${hex}`
        );

        console.log(`   ✅ Received price update from Hermes`);

        // Update oracle
        const [signer] = await ethers.getSigners();
        const Oracle = await ethers.getContractFactory("Oracle");
        const oracle = Oracle.attach(oracleAddress);

        // Get update fee
        const pythAddress = await oracle.pyth();
        const Pyth = await ethers.getContractAt("IPyth", pythAddress);
        const fee = await Pyth.getUpdateFee(updateData);

        console.log(`   Update fee: ${ethers.formatEther(fee)} ETH`);

        // Update price
        const tx = await oracle.updatePrice(updateData, { value: fee });
        console.log(`   Submitting update transaction: ${tx.hash}`);
        await tx.wait();

        // Read updated price
        const price = await oracle.getPrice();
        console.log(`   ✅ Oracle updated! Current price: ${ethers.formatEther(price)}`);

        return price;
    } catch (error: any) {
        console.error(`   ❌ Error updating oracle:`, error.message);
        throw error;
    }
}

async function main() {
    console.log("=== Executing Swap with Oracle Update ===\n");

    const [taker] = await ethers.getSigners();
    console.log(`Taker: ${await taker.getAddress()}`);

    // Get configuration
    const oracleAddress = process.env.ORACLE_ADDRESS;
    const token0Address = process.env.TOKEN0_ADDRESS;
    const token1Address = process.env.TOKEN1_ADDRESS;
    const swapAmount = process.env.SWAP_AMOUNT || "100";
    const minAmountOut = process.env.MIN_AMOUNT_OUT || "95";

    if (!oracleAddress) {
        throw new Error("ORACLE_ADDRESS not set");
    }
    if (!token0Address || !token1Address) {
        throw new Error("TOKEN0_ADDRESS and TOKEN1_ADDRESS must be set");
    }

    console.log("\nConfiguration:");
    console.log(`  Oracle: ${oracleAddress}`);
    console.log(`  Token0 (input): ${token0Address}`);
    console.log(`  Token1 (output): ${token1Address}`);
    console.log(`  Swap Amount: ${swapAmount}`);
    console.log(`  Min Amount Out: ${minAmountOut}`);

    // Step 1: Update oracle price
    const Oracle = await ethers.getContractFactory("Oracle");
    const oracle = Oracle.attach(oracleAddress);
    const priceId = await oracle.priceId();
    
    const updatedPrice = await updateOraclePrice(oracleAddress, priceId);

    // Step 2: Check token balances
    console.log("\n💰 Checking token balances...");
    const token0 = await ethers.getContractAt("TokenMock", token0Address);
    const token1 = await ethers.getContractAt("TokenMock", token1Address);
    
    const balance0Before = await token0.balanceOf(await taker.getAddress());
    const balance1Before = await token1.balanceOf(await taker.getAddress());
    
    console.log(`   Token0 balance: ${ethers.formatEther(balance0Before)}`);
    console.log(`   Token1 balance: ${ethers.formatEther(balance1Before)}`);

    // Step 3: Load order from file
    const orderFilePath = process.env.ORDER_FILE || "order.json";
    console.log(`\n📂 Loading order from ${orderFilePath}...`);
    
    let order: any;
    try {
        const fs = require("fs");
        if (!fs.existsSync(orderFilePath)) {
            throw new Error(`Order file not found: ${orderFilePath}. Run ship-liquidity.ts first.`);
        }
        
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
        order = {
            maker: orderData.maker,
            traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : orderData.traits,
            data: orderData.data
        };
        console.log(`   ✅ Order loaded`);
    } catch (error: any) {
        throw new Error(`Failed to load order: ${error.message}`);
    }

    // Step 4: Execute swap
    console.log("\n🔄 Executing swap...");
    
    // Get MockTaker contract (or use SwapVM directly)
    const mockTakerAddress = process.env.MOCK_TAKER_ADDRESS;
    if (!mockTakerAddress) {
        console.log("   ⚠️  MOCK_TAKER_ADDRESS not set, using direct SwapVM interaction");
        throw new Error("Direct SwapVM interaction not yet implemented. Use MockTaker.");
    }

    const MockTaker = await ethers.getContractFactory("MockTaker");
    const mockTaker = MockTaker.attach(mockTakerAddress);

    // Approve tokens
    console.log("   Approving tokens...");
    const approveTx = await token0.approve(mockTakerAddress, ethers.parseEther(swapAmount));
    await approveTx.wait();

    // Build taker traits
    const TakerTraitsLib = {
        build: (params: any) => {
            // Simplified taker traits building
            return ethers.zeroPadValue("0x00", 32); // Placeholder
        }
    };

    const takerData = TakerTraitsLib.build({
        taker: await taker.getAddress(),
        isExactIn: true,
        threshold: ethers.parseEther(minAmountOut),
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
    });

    console.log("   Submitting swap transaction...");
    const swapTx = await mockTaker.swap(
        order,
        token0Address,
        token1Address,
        ethers.parseEther(swapAmount),
        takerData
    );

    console.log(`   Transaction: ${swapTx.hash}`);
    const receipt = await swapTx.wait();
    console.log(`   ✅ Swap executed! Gas used: ${receipt?.gasUsed.toString()}`);

    // Step 5: Check balances after swap
    console.log("\n💰 Final balances:");
    const balance0After = await token0.balanceOf(await taker.getAddress());
    const balance1After = await token1.balanceOf(await taker.getAddress());
    
    console.log(`   Token0 balance: ${ethers.formatEther(balance0After)}`);
    console.log(`   Token1 balance: ${ethers.formatEther(balance1After)}`);
    console.log(`   Token0 change: ${ethers.formatEther(balance0After - balance0Before)}`);
    console.log(`   Token1 change: ${ethers.formatEther(balance1After - balance1Before)}`);

    console.log("\n✅ Swap with oracle update complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


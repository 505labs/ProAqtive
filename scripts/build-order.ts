// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to build a ProAquativeAMM order
 * 
 * Usage:
 *   npx hardhat run scripts/build-order.ts --network sepolia
 * 
 * Or with custom parameters:
 *   PYTH_ORACLE=0x... PRICE_ID=0x... npx hardhat run scripts/build-order.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract } from "./utils/helpers";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { ISwapVM } from "../typechain-types/@1inch/swap-vm/src/interfaces/ISwapVM";
import * as fs from "fs";

async function main() {
    console.log("=== Building ProAquativeAMM Order ===\n");

    // Get signers
    const [maker] = await ethers.getSigners();
    console.log(`Maker address: ${await maker.getAddress()}\n`);

    // Get deployed contracts
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");

    // Configuration (can be overridden via environment variables)
    const pythOracle = process.env.PYTH_ORACLE || "0x6ac8CE4fBd739EC9253eeEd263b2C2D61C633732"; // Replace with actual Pyth oracle
    const priceId = process.env.PRICE_ID || ethers.id("TEST_PRICE_ID");
    const k = process.env.K ? BigInt(process.env.K) : 600000000000000000n; // 0.6 (60%)
    const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : 7200n; // 1 hour
    const isTokenInBase = process.env.IS_TOKEN_IN_BASE !== "false"; // Default: true
    const baseDecimals = parseInt(process.env.BASE_DECIMALS || "18");
    const quoteDecimals = parseInt(process.env.QUOTE_DECIMALS || "18");

    console.log("Order Parameters:");
    console.log(`  Pyth Oracle: ${pythOracle}`);
    console.log(`  Price ID: ${priceId}`);
    console.log(`  k: ${k} (${Number(k) / 1e18 * 100}%)`);
    console.log(`  Max Staleness: ${maxStaleness} seconds`);
    console.log(`  Token In is Base: ${isTokenInBase}`);
    console.log(`  Base Decimals: ${baseDecimals}`);
    console.log(`  Quote Decimals: ${quoteDecimals}\n`);

    // Build the order
    console.log("Building order...");
    const order = await proAquativeAMM.buildProgram(
        await maker.getAddress(),
        pythOracle,
        priceId,
        k,
        maxStaleness,
        isTokenInBase,
        baseDecimals,
        quoteDecimals
    );

    console.log("\n✅ Order built successfully!");
    console.log("\nOrder Details:");
    console.log(`  Maker: ${order.maker}`);
    console.log(`  Traits: ${order.traits.toString()}`);
    console.log(`  Program Length: ${order.data.length} bytes`);
    console.log(`  Program (hex): 0x${order.data.slice(2).substring(0, 100)}...`);

    // Save order for use in other scripts
    const orderStruct = {
        maker: order.maker,
        traits: order.traits.toString(),
        data: order.data
    };

    // Save to file (default: order.json, can be overridden with ORDER_FILE env var)
    const orderFilePath = process.env.ORDER_FILE || "order.json";
    fs.writeFileSync(orderFilePath, JSON.stringify(orderStruct, null, 2));
    console.log(`\n💾 Order saved to: ${orderFilePath}`);
    console.log(`   You can now use this file in other scripts:`);
    console.log(`   ORDER_FILE=${orderFilePath} npx hardhat run scripts/ship-liquidity.ts --network sepolia`);

    console.log("\n📋 Order struct:");
    console.log(JSON.stringify(orderStruct, null, 2));

    return {
        maker: order.maker,
        traits: order.traits,
        data: order.data
    };
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


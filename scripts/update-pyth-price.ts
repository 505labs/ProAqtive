// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to update the price in MockPyth oracle
 * 
 * Usage:
 *   npx hardhat run scripts/update-pyth-price.ts --network sepolia
 * 
 * Or with custom parameters:
 *   PRICE_ID=0x... PRICE=200000000 npx hardhat run scripts/update-pyth-price.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, waitForTx, getDeployedAddress } from "./utils/helpers";

// ============================================================================
// CONFIGURATION: Edit these values to set default price parameters
// ============================================================================
const DEFAULT_PRICE_ID = "TEST_PRICE_ID";  // Price feed ID (string, will be hashed to bytes32)
const DEFAULT_PRICE = 200000000;            // Price value (int64, e.g., 200000000 = 2e8)
const DEFAULT_EXPONENT = 8;                 // Price exponent (int32, e.g., -8)
const DEFAULT_CONFIDENCE = 1000000;          // Confidence value (uint64, e.g., 1e6 = 0.01%)

async function main() {
    console.log("=== Updating MockPyth Price ===\n");

    // Get signers
    const [signer] = await ethers.getSigners();
    console.log(`Updater address: ${await signer.getAddress()}\n`);

    // Get MockPyth address
    let mockPythAddress = process.env.PYTH_ORACLE;
    if (!mockPythAddress || mockPythAddress === "0x0000000000000000000000000000000000000000") {
        mockPythAddress = await getDeployedAddress("MockPyth");
        if (!mockPythAddress || mockPythAddress === "") {
            throw new Error("MockPyth not found. Deploy it first: npx hardhat deploy --tags MockPyth --network sepolia");
        }
        console.log(`📍 Auto-detected MockPyth: ${mockPythAddress}\n`);
    } else {
        console.log(`📍 Using provided MockPyth: ${mockPythAddress}\n`);
    }

    const mockPyth = await ethers.getContractAt("MockPyth", mockPythAddress);

    // Get price parameters
    const priceIdRaw = process.env.PRICE_ID || DEFAULT_PRICE_ID;
    const priceId = priceIdRaw.startsWith('0x') ? priceIdRaw : ethers.id(priceIdRaw);
    const price = Number(process.env.PRICE || DEFAULT_PRICE);
    const confidence = Number(process.env.CONFIDENCE || DEFAULT_CONFIDENCE);
    const exponent = parseInt(process.env.EXPONENT || DEFAULT_EXPONENT.toString());

    // Check current price
    console.log("📊 Current Price Status:");
    try {
        const currentPrice = await mockPyth.prices(priceId);
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        const publishTime = BigInt(currentPrice.publishTime.toString());
        const age = currentTime - publishTime;

        console.log(`   Price ID: ${priceId}`);
        console.log(`   Current Price: ${currentPrice.price.toString()} (exponent: ${currentPrice.expo.toString()})`);
        console.log(`   Published: ${publishTime.toString()} (${new Date(Number(publishTime) * 1000).toISOString()})`);
        console.log(`   Age: ${age.toString()} seconds (${Number(age) / 60} minutes)`);
        console.log(`   Confidence: ${currentPrice.conf.toString()}\n`);
    } catch (error: any) {
        console.log(`   ⚠️  Could not read current price: ${error.message || error}`);
        console.log(`   💡 Price may not be set yet\n`);
    }

    // Update price
    console.log("🔄 Updating price...");
    console.log(`   Price ID: ${priceId} (from: ${priceIdRaw})`);
    console.log(`   Price: ${price} (exponent: ${exponent})`);
    console.log(`   Actual Price: ${price * Math.pow(10, exponent)}`);
    console.log(`   Confidence: ${confidence}\n`);

    try {
        const tx = await mockPyth.connect(signer).setPrice(priceId, price, confidence, exponent);
        await waitForTx(tx, "Update MockPyth price");

        // Verify new price
        const newPrice = await mockPyth.prices(priceId);
        const newPublishTime = BigInt(newPrice.publishTime.toString());
        console.log("\n✅ Price updated successfully!");
        console.log(`   New Price: ${newPrice.price.toString()} (exponent: ${newPrice.expo.toString()})`);
        console.log(`   Published: ${newPublishTime.toString()} (${new Date(Number(newPublishTime) * 1000).toISOString()})`);
        console.log(`   Confidence: ${newPrice.conf.toString()}`);
    } catch (error: any) {
        console.error("\n❌ Failed to update price:");
        console.error(`   ${error.message || error}`);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


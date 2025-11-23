// SPDX-License-Identifier: Apache-2.0

/**
 * Script to fetch signed price updates from Hermes API and update Pyth oracle
 * 
 * Usage:
 *   npx hardhat run scripts/update-pyth-price.ts --network sepolia
 * 
 * Environment variables:
 *   ORACLE_ADDRESS - Address of the Oracle contract
 *   PRICE_ID - Pyth price feed ID (e.g., ETH/USD)
 *   HERMES_URL - Hermes API endpoint (default: https://hermes.pyth.network)
 */

import { ethers } from "hardhat";
import axios from "axios";

// Hermes API endpoint for Pyth price feeds
const HERMES_API_URL = process.env.HERMES_URL || "https://hermes.pyth.network";

// Common Pyth Price Feed IDs
const PRICE_FEED_IDS = {
    "ETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    "BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    "SOL/USD": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    "USDC/USD": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    "USDT/USD": "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
};

interface HermesResponse {
    binary: {
        data: string[];
    };
}

/**
 * Fetch latest signed price update from Hermes API
 */
async function fetchPriceUpdate(priceId: string): Promise<string[]> {
    console.log(`📡 Fetching price update from Hermes API...`);
    console.log(`   Price ID: ${priceId}`);
    console.log(`   Hermes URL: ${HERMES_API_URL}`);

    try {
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

        if (!response.data.binary?.data || response.data.binary.data.length === 0) {
            throw new Error("No price data received from Hermes API");
        }

        const updateData = response.data.binary.data.map((hex: string) => 
            hex.startsWith('0x') ? hex : `0x${hex}`
        );

        console.log(`   ✅ Received ${updateData.length} price update(s)`);
        return updateData;
    } catch (error: any) {
        if (error.response) {
            console.error(`   ❌ Hermes API error: ${error.response.status} - ${error.response.statusText}`);
            console.error(`   Response:`, error.response.data);
        } else {
            console.error(`   ❌ Error fetching price update:`, error.message);
        }
        throw error;
    }
}

/**
 * Update the oracle with signed price data
 */
async function updateOracle(oracleAddress: string, updateData: string[]) {
    console.log(`\n📝 Updating oracle at ${oracleAddress}...`);

    const [signer] = await ethers.getSigners();
    console.log(`   Using signer: ${await signer.getAddress()}`);

    // Get Oracle contract
    const Oracle = await ethers.getContractFactory("Oracle");
    const oracle = Oracle.attach(oracleAddress);

    // Get the required fee for the update
    const pythAddress = await oracle.pyth();
    const Pyth = await ethers.getContractAt("IPyth", pythAddress);
    const fee = await Pyth.getUpdateFee(updateData);

    console.log(`   Update fee: ${ethers.formatEther(fee)} ETH`);

    // Check signer balance
    const balance = await ethers.provider.getBalance(await signer.getAddress());
    if (balance < fee) {
        throw new Error(`Insufficient balance. Need ${ethers.formatEther(fee)} ETH, have ${ethers.formatEther(balance)} ETH`);
    }

    // Update the price
    console.log(`   Submitting price update transaction...`);
    const tx = await oracle.updatePrice(updateData, { value: fee });
    console.log(`   Transaction hash: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`   ✅ Price updated! Gas used: ${receipt?.gasUsed.toString()}`);

    // Read the updated price
    try {
        const price = await oracle.getPrice();
        console.log(`   Current price: ${ethers.formatEther(price)} (scaled to 18 decimals)`);
    } catch (error: any) {
        console.log(`   ⚠️  Could not read price: ${error.message}`);
    }

    return tx;
}

/**
 * Get price feed ID from environment or lookup
 */
function getPriceId(): string {
    const priceId = process.env.PRICE_ID;
    
    if (priceId) {
        console.log(`📋 Using price ID from environment: ${priceId}`);
        return priceId;
    }

    // Try to lookup by pair name
    const pairName = process.env.PRICE_PAIR;
    if (pairName && PRICE_FEED_IDS[pairName as keyof typeof PRICE_FEED_IDS]) {
        const id = PRICE_FEED_IDS[pairName as keyof typeof PRICE_FEED_IDS];
        console.log(`📋 Using price ID for ${pairName}: ${id}`);
        return id;
    }

    // Default to ETH/USD
    console.log(`📋 No PRICE_ID specified, using ETH/USD`);
    return PRICE_FEED_IDS["ETH/USD"];
}

async function main() {
    console.log("=== Updating Pyth Oracle Price ===\n");

    // Get configuration
    const oracleAddress = process.env.ORACLE_ADDRESS;
    if (!oracleAddress) {
        throw new Error("ORACLE_ADDRESS environment variable is required");
    }

    const priceId = getPriceId();

    console.log("Configuration:");
    console.log(`  Oracle Address: ${oracleAddress}`);
    console.log(`  Price ID: ${priceId}`);
    console.log(`  Hermes URL: ${HERMES_API_URL}\n`);

    // Fetch price update from Hermes
    const updateData = await fetchPriceUpdate(priceId);

    // Update the oracle
    await updateOracle(oracleAddress, updateData);

    console.log("\n✅ Oracle update complete!");
    console.log("\n💡 Available price feeds:");
    Object.entries(PRICE_FEED_IDS).forEach(([pair, id]) => {
        console.log(`   ${pair}: ${id}`);
    });
    console.log("\n💡 To use a different price feed:");
    console.log(`   PRICE_ID=0x... npx hardhat run scripts/update-pyth-price.ts --network sepolia`);
    console.log(`   or`);
    console.log(`   PRICE_PAIR=BTC/USD npx hardhat run scripts/update-pyth-price.ts --network sepolia`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


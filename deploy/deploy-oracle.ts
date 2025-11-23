// SPDX-License-Identifier: Apache-2.0

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploy Oracle contract that wraps Pyth price feeds
 * 
 * Sepolia Testnet:
 *   - Pyth Oracle: 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21
 * 
 * Mainnet (when ready):
 *   - Pyth Oracle: 0x4305FB66699C3B2702D4d05CF36551390A4c69C6
 * 
 * Common Price Feed IDs:
 *   - ETH/USD: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
 *   - BTC/USD: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
 *   - USDC/USD: 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a
 */

const deployOracle: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network, ethers } = hre;
    const { deploy, save, getOrNull } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log("\n=== Deploying Oracle Contract ===");
    console.log(`Network: ${network.name}`);
    console.log(`Deployer: ${deployer}\n`);

    // Network-specific Pyth oracle addresses
    const PYTH_ADDRESSES: Record<string, string> = {
        sepolia: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21",
        mainnet: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6",
        arbitrum: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
        optimism: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
        polygon: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
    };

    // Common price feed IDs
    const PRICE_FEED_IDS: Record<string, string> = {
        "ETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        "BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        "SOL/USD": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        "USDC/USD": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    };

    // Get configuration from environment or use defaults
    let pythAddress = process.env.PYTH_ADDRESS || PYTH_ADDRESSES[network.name];
    let priceId = process.env.PRICE_ID || PRICE_FEED_IDS["ETH/USD"];
    const maxStaleness = process.env.MAX_STALENESS || "60"; // 60 seconds default

    // Check if we should deploy MockPyth for testing
    if (!pythAddress || pythAddress === "0x0000000000000000000000000000000000000000") {
        console.log("⚠️  No Pyth address found for this network");
        console.log("   Checking for MockPyth deployment...");
        
        const mockPyth = await getOrNull("MockPyth");
        if (mockPyth) {
            pythAddress = mockPyth.address;
            console.log(`   ✅ Using MockPyth at ${pythAddress}`);
        } else {
            console.log("   ❌ MockPyth not deployed");
            console.log("   💡 Deploy MockPyth first:");
            console.log(`      npx hardhat deploy --tags MockPyth --network ${network.name}`);
            throw new Error("Pyth oracle address not available");
        }
    }

    console.log("Configuration:");
    console.log(`  Pyth Address: ${pythAddress}`);
    console.log(`  Price Feed ID: ${priceId}`);
    console.log(`  Max Staleness: ${maxStaleness} seconds\n`);

    // Deploy Oracle
    const oracle = await deploy("Oracle", {
        from: deployer,
        args: [pythAddress, priceId, maxStaleness],
        log: true,
        waitConfirmations: network.name === "hardhat" ? 1 : 2,
    });

    if (oracle.newlyDeployed) {
        console.log(`✅ Oracle deployed at: ${oracle.address}`);
        console.log(`   Transaction: ${oracle.transactionHash}\n`);

        // Try to read the initial state
        try {
            const oracleContract = await ethers.getContractAt("Oracle", oracle.address);
            const pythAddr = await oracleContract.pyth();
            const pId = await oracleContract.priceId();
            const maxStale = await oracleContract.maxStaleness();

            console.log("Oracle Configuration:");
            console.log(`  Pyth Oracle: ${pythAddr}`);
            console.log(`  Price Feed ID: ${pId}`);
            console.log(`  Max Staleness: ${maxStale.toString()} seconds\n`);

            // Try to read price (might fail if no price update yet)
            try {
                const price = await oracleContract.getPriceUnsafe();
                console.log(`  Current Price: ${ethers.formatEther(price)} (18 decimals)\n`);
            } catch (e) {
                console.log("  ⚠️  No price available yet. Update price using Hermes API:");
                console.log(`     ORACLE_ADDRESS=${oracle.address} npx hardhat run scripts/update-pyth-price.ts --network ${network.name}\n`);
            }
        } catch (e) {
            console.log("  ⚠️  Could not read oracle state\n");
        }

        // Print usage instructions
        console.log("📝 Next Steps:");
        console.log("1. Update price using Hermes API:");
        console.log(`   ORACLE_ADDRESS=${oracle.address} npx hardhat run scripts/update-pyth-price.ts --network ${network.name}`);
        console.log("\n2. Use this oracle in your DODOSwap orders:");
        console.log(`   ORACLE_ADDRESS=${oracle.address} npx hardhat run scripts/ship-liquidity.ts --network ${network.name}`);
        console.log("\n3. Available price feeds:");
        Object.entries(PRICE_FEED_IDS).forEach(([pair, id]) => {
            console.log(`   ${pair}: ${id}`);
        });
        console.log("\n4. To deploy oracle with different price feed:");
        console.log(`   PRICE_ID=0x... npx hardhat deploy --tags Oracle --network ${network.name}`);
    } else {
        console.log(`✅ Oracle already deployed at: ${oracle.address}\n`);
    }
};

deployOracle.tags = ["Oracle", "price"];
deployOracle.dependencies = []; // Can depend on MockPyth if needed

export default deployOracle;


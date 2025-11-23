// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to deploy SmartYieldVault and build an order with hooks enabled
 * 
 * Usage:
 *   AAVE_POOL=0x... npx hardhat run scripts/deploy-vault-order.ts --network sepolia
 * 
 * Or with custom parameters:
 *   AQUA_ROUTER=0x... AAVE_POOL=0x... npx hardhat run scripts/deploy-vault-order.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, getDeployedAddress, waitForTx } from "./utils/helpers";
import { SmartYieldVault } from "../typechain-types/contracts/SmartYieldVault.sol/SmartYieldVault";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { MakerTraitsLib } from "../test/utils/SwapVMHelpers";

async function main() {
    console.log("=== Deploying SmartYieldVault and Building Order ===\n");

    // Get signers
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}\n`);

    // Get deployed contracts
    const aquaRouter = await getDeployedAddress("CustomSwapVMRouter");
    if (!aquaRouter) {
        throw new Error("CustomSwapVMRouter not deployed. Please deploy it first.");
    }
    console.log(`Aqua Router (CustomSwapVMRouter): ${aquaRouter}`);

    // Get Aave Pool address from environment or use a default (for Sepolia testnet)
    // Aave V3 Pool on Sepolia: 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
    const aavePool = process.env.AAVE_POOL || "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
    if (!aavePool || aavePool === ethers.ZeroAddress) {
        throw new Error("AAVE_POOL environment variable is required");
    }
    console.log(`Aave Pool: ${aavePool}\n`);

    // Deploy SmartYieldVault
    console.log("Deploying SmartYieldVault...");
    const SmartYieldVaultFactory = await ethers.getContractFactory("SmartYieldVault");
    const vault = await SmartYieldVaultFactory.deploy(
        aquaRouter,
        aavePool,
        deployerAddress
    );
    await waitForTx(vault.deploymentTransaction(), "Deploy SmartYieldVault");

    const vaultAddress = await vault.getAddress();
    console.log(`✅ SmartYieldVault deployed at: ${vaultAddress}\n`);

    // Get ProAquativeAMM to build a program (or use any AMM that builds programs)
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");

    // Configuration for the order program (using ProAquativeAMM as example)
    // You can customize these or use a different AMM
    const pythOracle = process.env.PYTH_ORACLE || "0x6ac8CE4fBd739EC9253eeEd263b2C2D61C633732";
    const priceId = process.env.PRICE_ID || ethers.id("TEST_PRICE_ID");
    const k = process.env.K ? BigInt(process.env.K) : 400000000000000000n; // 0.4 (40%)
    const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : 7200n; // 2 hours
    const isTokenInBase = process.env.IS_TOKEN_IN_BASE !== "false";
    const baseDecimals = parseInt(process.env.BASE_DECIMALS || "18");
    const quoteDecimals = parseInt(process.env.QUOTE_DECIMALS || "18");

    console.log("Building order program with ProAquativeAMM (with hooks)...");

    // Build order directly with hooks enabled using the new overloaded function
    // We need to encode the HookConfig struct
    const hookConfig = {
        hasPreTransferInHook: false,
        hasPostTransferInHook: true,
        hasPreTransferOutHook: true,
        hasPostTransferOutHook: false,
        preTransferInTarget: ethers.ZeroAddress,
        postTransferInTarget: vaultAddress,
        preTransferOutTarget: vaultAddress,
        postTransferOutTarget: ethers.ZeroAddress,
        preTransferInData: "0x",
        postTransferInData: "0x",
        preTransferOutData: "0x",
        postTransferOutData: "0x"
    };

    // Call the overloaded buildProgram function with hooks
    // TypeScript may need explicit type casting for the struct
    const orderWithHooks = await (proAquativeAMM as any).buildProgram(
        vaultAddress, // Maker is the vault
        pythOracle,
        priceId,
        k,
        maxStaleness,
        isTokenInBase,
        baseDecimals,
        quoteDecimals,
        hookConfig
    );

    console.log("\n✅ Order built successfully with hooks!\n");

    console.log("Order Details:");
    console.log(`  Maker (Vault): ${orderWithHooks.maker}`);
    console.log(`  Traits (hex): ${orderWithHooks.traits}`);
    console.log(`  Traits (numeric): ${BigInt(orderWithHooks.traits).toString()}`);
    console.log(`  Program Length: ${ethers.getBytes(orderWithHooks.data).length} bytes`);
    console.log(`  PreTransferOut Hook: Enabled (target: ${vaultAddress})`);
    console.log(`  PostTransferIn Hook: Enabled (target: ${vaultAddress})`);

    // Display the traits value as requested
    const traitsValue = BigInt(orderWithHooks.traits);
    console.log(`\n📊 MakerTraits Numeric Value: ${traitsValue.toString()}`);
    console.log(`   (Hex: ${orderWithHooks.traits})`);

    // Show which flags are set
    console.log("\n📋 Enabled Flags:");
    const flags = {
        "USE_AQUA_INSTEAD_OF_SIGNATURE": (traitsValue & (1n << 254n)) !== 0n,
        "HAS_PRE_TRANSFER_OUT_HOOK": (traitsValue & (1n << 250n)) !== 0n,
        "HAS_POST_TRANSFER_IN_HOOK": (traitsValue & (1n << 251n)) !== 0n,
        "PRE_TRANSFER_OUT_HOOK_HAS_TARGET": (traitsValue & (1n << 246n)) !== 0n,
        "POST_TRANSFER_IN_HOOK_HAS_TARGET": (traitsValue & (1n << 247n)) !== 0n,
    };

    for (const [flag, enabled] of Object.entries(flags)) {
        console.log(`   ${flag}: ${enabled ? "✅" : "❌"}`);
    }

    console.log("\n💡 Next Steps:");
    console.log(`   1. The vault is ready to act as a Maker on Aqua`);
    console.log(`   2. Use this order when shipping liquidity:`);
    console.log(`      ORDER_FILE=order.json npx hardhat run scripts/ship-liquidity.ts --network sepolia`);
    console.log(`   3. The vault will automatically:`);
    console.log(`      - Withdraw from Aave when tokens are needed (preTransferOut)`);
    console.log(`      - Deposit to Aave after receiving tokens (postTransferIn)`);

    return {
        vaultAddress,
        order: orderWithHooks,
        traitsValue: traitsValue.toString()
    };
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


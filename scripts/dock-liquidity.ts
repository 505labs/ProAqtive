// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to dock (withdraw) liquidity from Aqua
 * 
 * Usage:
 *   ORDER_FILE=order.json TOKEN0=0x... TOKEN1=0x... npx hardhat run scripts/dock-liquidity.ts --network sepolia
 * 
 * Note: After docking, you may need to pull tokens to withdraw them to your address.
 *       See pull-liquidity.ts for that.
 */

import { ethers } from "hardhat";
import { getDeployedContract, waitForTx, displayBalance, getDeployedAddress, formatTokenAmount } from "./utils/helpers";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import * as fs from "fs";

const DEFAULT_TOKEN0_ADDRESS = "0x6105E77Cd7942c4386C01d1F0B9DD7876141c549";  // Mock ETH
const DEFAULT_TOKEN1_ADDRESS = "0x5aA57352bF243230Ce55dFDa70ba9c3A253432f6";  // Mock USDC

async function main() {
    console.log("=== Docking Liquidity from Aqua ===\n");

    // Get signers
    const [maker] = await ethers.getSigners();
    const makerAddress = await maker.getAddress();
    console.log(`Maker address: ${makerAddress}\n`);

    // Get deployed contracts
    const aqua = await getDeployedContract<Aqua>("Aqua");
    const swapVM = await getDeployedContract<CustomSwapVMRouter>("CustomSwapVMRouter");
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");

    // Get token addresses from environment or use defaults
    const token0Address = process.env.TOKEN0 || DEFAULT_TOKEN0_ADDRESS;
    const token1Address = process.env.TOKEN1 || DEFAULT_TOKEN1_ADDRESS;

    if (!token0Address || !token1Address) {
        throw new Error("TOKEN0 and TOKEN1 environment variables are required");
    }

    const token0 = await ethers.getContractAt("IERC20", token0Address) as any;
    const token1 = await ethers.getContractAt("IERC20", token1Address) as any;

    // Load order from file (required for docking)
    const orderFilePath = process.env.ORDER_FILE || "order.json";
    if (!fs.existsSync(orderFilePath)) {
        throw new Error(`Order file not found: ${orderFilePath}\n` +
            "You must provide the same order that was used when shipping liquidity.\n" +
            "Use ORDER_FILE=order.json or ensure order.json exists from ship-liquidity.ts");
    }

    console.log(`📂 Loading order from ${orderFilePath}...`);
    const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
    const order = {
        maker: orderData.maker,
        traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : BigInt(orderData.traits),
        data: orderData.data
    };

    // Verify maker matches
    if (order.maker.toLowerCase() !== makerAddress.toLowerCase()) {
        console.warn(`\n⚠️  WARNING: Order maker (${order.maker}) doesn't match current signer (${makerAddress})`);
        console.warn("   You can only dock liquidity for orders you created!");
        throw new Error("Maker address mismatch");
    }

    // Encode order to get strategy hash
    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };
    const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address maker, uint256 traits, bytes data)"],
        [orderStruct]
    );
    const strategyHash = ethers.keccak256(encodedOrder);

    console.log("\n📋 Order Details:");
    console.log(`  Maker: ${order.maker}`);
    console.log(`  Strategy Hash: ${strategyHash}`);
    console.log(`  Token0: ${token0Address}`);
    console.log(`  Token1: ${token1Address}`);

    // Check current balances in Aqua
    const aquaAddress = await aqua.getAddress();
    const swapVMAddress = await swapVM.getAddress();

    console.log("\n🔍 Checking current liquidity in Aqua...");
    const balance0Before = await token0.balanceOf(aquaAddress);
    const balance1Before = await token1.balanceOf(aquaAddress);
    const makerBalance0Before = await token0.balanceOf(makerAddress);
    const makerBalance1Before = await token1.balanceOf(makerAddress);

    console.log(`  Aqua Token0 balance: ${formatTokenAmount(balance0Before)}`);
    console.log(`  Aqua Token1 balance: ${formatTokenAmount(balance1Before)}`);
    console.log(`  Maker Token0 balance: ${formatTokenAmount(makerBalance0Before)}`);
    console.log(`  Maker Token1 balance: ${formatTokenAmount(makerBalance1Before)}`);

    if (balance0Before === 0n && balance1Before === 0n) {
        console.log("\n   ⚠️  No liquidity found in Aqua for these tokens");
        console.log("   💡 Make sure you're using the correct order file and token addresses");
        throw new Error("No liquidity found to dock");
    }

    // Dock liquidity
    console.log("\n🚢 Docking liquidity from Aqua...");
    try {
        const dockTx = await aqua.connect(maker).dock(
            swapVMAddress,
            strategyHash,
            [token0Address, token1Address]
        );

        await waitForTx(dockTx, "Dock liquidity");
    } catch (error: any) {
        console.error("\n❌ Failed to dock liquidity:");

        // Try to extract detailed error information
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
        console.log("  1. Verify you're using the correct order file:");
        console.log(`     - ORDER_FILE=${orderFilePath}`);
        console.log("  2. Verify the order matches the one used when shipping:");
        console.log(`     - Strategy Hash: ${strategyHash}`);
        console.log("  3. Verify you're the maker of this order:");
        console.log(`     - Order Maker: ${order.maker}`);
        console.log(`     - Your Address: ${makerAddress}`);
        console.log("  4. Verify token addresses are correct:");
        console.log(`     - Token0: ${token0Address}`);
        console.log(`     - Token1: ${token1Address}`);
        console.log("  5. Note: Docking requires all tokens to be in the same state");
        console.log("     - All tokens must have been shipped together");
        console.log("     - Cannot dock partial liquidity");

        throw error;
    }

    // Check balances after docking
    console.log("\nBalances after docking:");
    const balance0After = await token0.balanceOf(aquaAddress);
    const balance1After = await token1.balanceOf(aquaAddress);
    const makerBalance0After = await token0.balanceOf(makerAddress);
    const makerBalance1After = await token1.balanceOf(makerAddress);

    console.log(`  Aqua Token0 balance: ${formatTokenAmount(balance0After)}`);
    console.log(`  Aqua Token1 balance: ${formatTokenAmount(balance1After)}`);
    console.log(`  Maker Token0 balance: ${formatTokenAmount(makerBalance0After)}`);
    console.log(`  Maker Token1 balance: ${formatTokenAmount(makerBalance1After)}`);

    console.log("\n✅ Liquidity docked successfully!");
    console.log(`\nStrategy Hash: ${strategyHash}`);
    console.log("\n💡 Note: Docking marks the strategy as closed, but tokens remain in Aqua.");
    console.log("   To withdraw tokens to your address, use pull-liquidity.ts");
    console.log(`   Example: ORDER_FILE=${orderFilePath} TOKEN0=${token0Address} TOKEN1=${token1Address} npx hardhat run scripts/pull-liquidity.ts --network sepolia`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to ship liquidity to Aqua with a ProAquativeAMM order
 * 
 * Usage:
 *   TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 npx hardhat run scripts/ship-liquidity.ts --network sepolia
 * 
 * Or use ORDER_FILE to load a previously built order:
 *   ORDER_FILE=order.json TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 npx hardhat run scripts/ship-liquidity.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, waitForTx, displayBalance, parseTokenAmount } from "./utils/helpers";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20";
import * as fs from "fs";
import * as path from "path";


const DEFAULT_TOKEN0_ADDRESS = "0x6105E77Cd7942c4386C01d1F0B9DD7876141c549";  // Mock ETH
const DEFAULT_TOKEN1_ADDRESS = "0x5aA57352bF243230Ce55dFDa70ba9c3A253432f6";  // Mock USDC
// const DEFAULT_AMOUNT0 = "100";
// const DEFAULT_AMOUNT1 = "200";

async function main() {
    console.log("=== Shipping Liquidity to Aqua ===\n");

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

    const token0 = await ethers.getContractAt("IERC20", token0Address);
    const token1 = await ethers.getContractAt("IERC20", token1Address);

    // Get token amounts
    const amount0 = parseTokenAmount(process.env.AMOUNT0 || "100");
    const amount1 = parseTokenAmount(process.env.AMOUNT1 || "200");

    console.log("Configuration:");
    console.log(`  Token0: ${token0Address}`);
    console.log(`  Token1: ${token1Address}`);
    console.log(`  Amount0: ${amount0.toString()}`);
    console.log(`  Amount1: ${amount1.toString()}\n`);

    // Check balances
    console.log("Current Balances:");
    await displayBalance(token0, makerAddress, "Token0 balance");
    await displayBalance(token1, makerAddress, "Token1 balance");

    // Check allowances
    const allowance0 = await token0.allowance(makerAddress, await aqua.getAddress());
    const allowance1 = await token1.allowance(makerAddress, await aqua.getAddress());

    console.log("\nAllowances:");
    console.log(`  Token0 allowance: ${allowance0.toString()}`);
    console.log(`  Token1 allowance: ${allowance1.toString()}`);

    // Approve if needed
    if (allowance0 < amount0) {
        console.log("\n⚠️  Token0 allowance insufficient, approving...");
        const approveTx0 = await token0.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
        await waitForTx(approveTx0, "Approve Token0");
    }

    if (allowance1 < amount1) {
        console.log("\n⚠️  Token1 allowance insufficient, approving...");
        const approveTx1 = await token1.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
        await waitForTx(approveTx1, "Approve Token1");
    }

    // Build or load order
    let order;
    const orderFilePath = process.env.ORDER_FILE;
    if (orderFilePath && fs.existsSync(orderFilePath)) {
        console.log(`\n📂 Loading order from ${orderFilePath}...`);
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
        order = {
            maker: orderData.maker,
            traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : BigInt(orderData.traits),
            data: orderData.data
        };
    } else {
        console.log("\n🔨 Building new order...");
        // Use default parameters or environment variables
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

    // Encode order
    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };
    const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address maker, uint256 traits, bytes data)"],
        [orderStruct]
    );

    // Ship liquidity
    console.log("\n🚢 Shipping liquidity to Aqua...");
    const shipTx = await aqua.connect(maker).ship(
        await swapVM.getAddress(),
        encodedOrder,
        [token0Address, token1Address],
        [amount0, amount1]
    );

    await waitForTx(shipTx, "Ship liquidity");

    // Check balances after
    console.log("\nBalances after shipping:");
    await displayBalance(token0, makerAddress, "Token0 balance");
    await displayBalance(token1, makerAddress, "Token1 balance");

    console.log("\n✅ Liquidity shipped successfully!");
    console.log(`\nOrder hash: ${ethers.keccak256(encodedOrder)}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


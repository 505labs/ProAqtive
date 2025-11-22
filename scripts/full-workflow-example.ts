// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Complete workflow example: Build order, ship liquidity, get quote, execute swap
 * 
 * This script demonstrates the complete flow from order creation to swap execution.
 * 
 * Usage:
 *   TOKEN0=0x... TOKEN1=0x... PYTH_ORACLE=0x... PRICE_ID=0x... npx hardhat run scripts/full-workflow-example.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, waitForTx, displayBalance, parseTokenAmount, formatTokenAmount } from "./utils/helpers";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20";
import { TakerTraitsLib } from "../test/utils/SwapVMHelpers";

async function main() {
    console.log("=== Complete ProAquativeAMM Workflow ===\n");

    // Get signers
    const [maker, taker] = await ethers.getSigners();
    const makerAddress = await maker.getAddress();
    const takerAddress = await taker.getAddress();

    console.log(`Maker: ${makerAddress}`);
    console.log(`Taker: ${takerAddress}\n`);

    // Get deployed contracts
    const aqua = await getDeployedContract<Aqua>("Aqua");
    const swapVM = await getDeployedContract<CustomSwapVMRouter>("CustomSwapVMRouter");
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");

    // Configuration
    const token0Address = process.env.TOKEN0 || process.env.TOKEN0_ADDRESS;
    const token1Address = process.env.TOKEN1 || process.env.TOKEN1_ADDRESS;

    if (!token0Address || !token1Address) {
        throw new Error("TOKEN0 and TOKEN1 environment variables are required");
    }

    const token0 = await ethers.getContractAt("IERC20", token0Address);
    const token1 = await ethers.getContractAt("IERC20", token1Address);

    const liquidity0 = parseTokenAmount(process.env.LIQUIDITY0 || "100");
    const liquidity1 = parseTokenAmount(process.env.LIQUIDITY1 || "200");
    const swapAmount = parseTokenAmount(process.env.SWAP_AMOUNT || "10");

    // Step 1: Build Order
    console.log("Step 1: Building Order...");
    const pythOracle = process.env.PYTH_ORACLE || "0x0000000000000000000000000000000000000000";
    const priceId = process.env.PRICE_ID || ethers.id("TEST_PRICE_ID");
    const k = process.env.K ? BigInt(process.env.K) : 500000000000000000n;
    const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : 3600n;

    const order = await proAquativeAMM.buildProgram(
        makerAddress,
        pythOracle,
        priceId,
        k,
        maxStaleness,
        true, // tokenIn is base
        18,
        18
    );

    console.log("✅ Order built\n");

    // Step 2: Check and Approve Tokens
    console.log("Step 2: Checking balances and approvals...");
    await displayBalance(token0, makerAddress, "Maker Token0");
    await displayBalance(token1, makerAddress, "Maker Token1");

    const allowance0 = await token0.allowance(makerAddress, await aqua.getAddress());
    const allowance1 = await token1.allowance(makerAddress, await aqua.getAddress());

    if (allowance0 < liquidity0) {
        console.log("Approving Token0...");
        await waitForTx(
            await token0.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256),
            "Approve Token0"
        );
    }

    if (allowance1 < liquidity1) {
        console.log("Approving Token1...");
        await waitForTx(
            await token1.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256),
            "Approve Token1"
        );
    }
    console.log("✅ Approvals complete\n");

    // Step 3: Ship Liquidity
    console.log("Step 3: Shipping liquidity...");
    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };
    const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address maker, uint256 traits, bytes data)"],
        [orderStruct]
    );

    await waitForTx(
        await aqua.connect(maker).ship(
            await swapVM.getAddress(),
            encodedOrder,
            [token0Address, token1Address],
            [liquidity0, liquidity1]
        ),
        "Ship liquidity"
    );
    console.log("✅ Liquidity shipped\n");

    // Step 4: Get Quote
    console.log("Step 4: Getting quote...");
    try {
        const quote = await swapVM.quote(
            orderStruct,
            token0Address,
            token1Address,
            swapAmount
        );
        console.log(`   Input: ${formatTokenAmount(swapAmount)} Token0`);
        console.log(`   Output: ${formatTokenAmount(quote)} Token1`);
        console.log("✅ Quote received\n");
    } catch (error: any) {
        console.log(`   ⚠️  Could not get quote: ${error.message}\n`);
    }

    // Step 5: Execute Swap
    console.log("Step 5: Executing swap...");

    // Check taker balance
    await displayBalance(token0, takerAddress, "Taker Token0 (before)");
    await displayBalance(token1, takerAddress, "Taker Token1 (before)");

    // Approve if needed
    const takerAllowance = await token0.allowance(takerAddress, await swapVM.getAddress());
    if (takerAllowance < swapAmount) {
        await waitForTx(
            await token0.connect(taker).approve(await swapVM.getAddress(), ethers.MaxUint256),
            "Taker approve Token0"
        );
    }

    // Build taker data
    const takerData = TakerTraitsLib.build({
        taker: takerAddress,
        isExactIn: true,
        threshold: 0n,
        useTransferFromAndAquaPush: true
    });

    // Execute swap
    await waitForTx(
        await swapVM.connect(taker).swap(
            orderStruct,
            token0Address,
            token1Address,
            swapAmount,
            takerData
        ),
        "Execute swap"
    );

    // Check balances after
    await displayBalance(token0, takerAddress, "Taker Token0 (after)");
    await displayBalance(token1, takerAddress, "Taker Token1 (after)");

    console.log("\n✅ Complete workflow finished successfully!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


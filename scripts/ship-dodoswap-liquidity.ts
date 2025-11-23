// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to ship liquidity to Aqua with a DODOSwap order
 * 
 * Usage:
 *   ORACLE_ADDRESS=0x... TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=281500 npx hardhat run scripts/ship-dodoswap-liquidity.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedContract, waitForTx, displayBalance, parseTokenAmount, formatTokenAmount } from "./utils/helpers";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { MyCustomOpcodes } from "../typechain-types/contracts/MyCustomOpcodes";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";

async function main() {
    console.log("=== Shipping DODOSwap Liquidity to Aqua ===\n");

    // Get signers
    const [maker] = await ethers.getSigners();
    const makerAddress = await maker.getAddress();
    console.log(`Maker address: ${makerAddress}\n`);

    // Get deployed contracts
    const aqua = await getDeployedContract<Aqua>("Aqua");
    const myCustomOpcodes = await getDeployedContract<MyCustomOpcodes>("MyCustomOpcodes");

    // Get configuration from environment
    const oracleAddress = process.env.ORACLE_ADDRESS;
    if (!oracleAddress) {
        throw new Error("ORACLE_ADDRESS environment variable is required");
    }

    const token0Address = process.env.TOKEN0; // mETH (base)
    const token1Address = process.env.TOKEN1; // mUSDC (quote)
    
    if (!token0Address || !token1Address) {
        throw new Error("TOKEN0 and TOKEN1 environment variables are required");
    }

    const token0 = await ethers.getContractAt("IERC20", token0Address) as any;
    const token1 = await ethers.getContractAt("IERC20", token1Address) as any;

    // Get amounts (defaults: 100 mETH, 281500 mUSDC matching $2815/ETH)
    const amount0 = parseTokenAmount(process.env.AMOUNT0 || "100");  // 100 mETH
    const amount1 = parseTokenAmount(process.env.AMOUNT1 || "281500"); // 281500 mUSDC (~$2815 * 100)

    // DODOSwap parameters
    const k = process.env.K ? BigInt(process.env.K) : ethers.parseEther("0.1"); // 0.1 = 10% liquidity depth (tighter curve)
    const targetBaseAmount = parseTokenAmount(process.env.TARGET_BASE || "100"); // Match amount0
    const targetQuoteAmount = parseTokenAmount(process.env.TARGET_QUOTE || "281500"); // Match amount1
    const baseIsTokenIn = process.env.BASE_IS_TOKEN_IN !== "false"; // true = base (mETH) is input

    console.log("Configuration:");
    console.log(`  Oracle: ${oracleAddress}`);
    console.log(`  Token0 (Base - mETH): ${token0Address}`);
    console.log(`  Token1 (Quote - mUSDC): ${token1Address}`);
    console.log(`  Amount0 (mETH): ${ethers.formatEther(amount0)}`);
    console.log(`  Amount1 (mUSDC): ${ethers.formatEther(amount1)}`);
    console.log(`  K parameter: ${ethers.formatEther(k)}`);
    console.log(`  Target Base Amount: ${ethers.formatEther(targetBaseAmount)}`);
    console.log(`  Target Quote Amount: ${ethers.formatEther(targetQuoteAmount)}`);
    console.log(`  Base is Token In: ${baseIsTokenIn}\n`);

    // Check balances
    console.log("Current Balances:");
    await displayBalance(token0, makerAddress, "mETH balance");
    await displayBalance(token1, makerAddress, "mUSDC balance");

    // Verify balances are sufficient
    const balance0 = await token0.balanceOf(makerAddress);
    const balance1 = await token1.balanceOf(makerAddress);

    if (balance0 < amount0) {
        throw new Error(`Insufficient mETH balance: have ${ethers.formatEther(balance0)}, need ${ethers.formatEther(amount0)}`);
    }
    if (balance1 < amount1) {
        throw new Error(`Insufficient mUSDC balance: have ${ethers.formatEther(balance1)}, need ${ethers.formatEther(amount1)}`);
    }

    // Approve tokens to Aqua
    const aquaAddress = await aqua.getAddress();
    const allowance0 = await token0.allowance(makerAddress, aquaAddress);
    const allowance1 = await token1.allowance(makerAddress, aquaAddress);

    console.log("\nAllowances:");
    console.log(`  mETH allowance: ${ethers.formatEther(allowance0)}`);
    console.log(`  mUSDC allowance: ${ethers.formatEther(allowance1)}`);

    if (allowance0 < amount0) {
        console.log("\n⚠️  mETH allowance insufficient, approving...");
        const approveTx0 = await token0.connect(maker).approve(aquaAddress, ethers.MaxUint256);
        await waitForTx(approveTx0, "Approve mETH");
    }

    if (allowance1 < amount1) {
        console.log("\n⚠️  mUSDC allowance insufficient, approving...");
        const approveTx1 = await token1.connect(maker).approve(aquaAddress, ethers.MaxUint256);
        await waitForTx(approveTx1, "Approve mUSDC");
    }

    // Build DODOSwap program
    console.log("\n🔨 Building DODOSwap program...");

    // DODOParams struct
    const dodoParams = {
        oracle: oracleAddress,
        k: k,
        targetBaseAmount: targetBaseAmount,
        targetQuoteAmount: targetQuoteAmount,
        baseIsTokenIn: baseIsTokenIn
    };

    // Encode DODOParams
    const dodoParamsEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address oracle, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"],
        [dodoParams]
    );

    // Build program using ProgramBuilder
    const programBuilder = new ProgramBuilder();
    
    // DODOSwap opcode is 0x1D (29)
    const DODOSWAP_OPCODE = 0x1D;
    
    // Build the program: DODOSWAP instruction
    programBuilder.addInstruction(DODOSWAP_OPCODE, dodoParamsEncoded);
    
    const programBytes = programBuilder.build();

    console.log(`  DODOSwap Opcode: 0x${DODOSWAP_OPCODE.toString(16)}`);
    console.log(`  Program size: ${programBytes.length} bytes`);
    console.log(`  Parameters encoded: ${dodoParamsEncoded.slice(0, 66)}...`);

    // Create order structure
    // Traits: Set the maker traits (0 for basic order)
    const traits = 0n;
    
    const order = {
        maker: makerAddress,
        traits: traits,
        data: programBytes
    };

    // Encode order
    const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address maker, uint256 traits, bytes data)"],
        [order]
    );

    console.log("\n📋 Order Details:");
    console.log(`  Maker: ${order.maker}`);
    console.log(`  Traits: ${order.traits.toString()}`);
    console.log(`  Data length: ${order.data.length} bytes`);

    // Verify contracts
    const myCustomOpcodesAddress = await myCustomOpcodes.getAddress();
    console.log(`\n📍 Contract Addresses:`);
    console.log(`  Aqua: ${aquaAddress}`);
    console.log(`  MyCustomOpcodes (Router): ${myCustomOpcodesAddress}`);
    console.log(`  Oracle: ${oracleAddress}`);

    // Ship liquidity
    console.log("\n🚢 Shipping DODOSwap liquidity to Aqua...");
    try {
        const shipTx = await aqua.connect(maker).ship(
            myCustomOpcodesAddress,
            encodedOrder,
            [token0Address, token1Address],
            [amount0, amount1]
        );

        await waitForTx(shipTx, "Ship DODOSwap liquidity");
    } catch (error: any) {
        console.error("\n❌ Failed to ship liquidity:");
        console.error(`   Message: ${error.message || error}`);
        
        if (error.reason) {
            console.error(`   Reason: ${error.reason}`);
        }
        
        throw error;
    }

    // Check balances after
    console.log("\nBalances after shipping:");
    await displayBalance(token0, makerAddress, "mETH balance");
    await displayBalance(token1, makerAddress, "mUSDC balance");

    console.log("\n✅ DODOSwap liquidity shipped successfully!");
    console.log(`\n💡 Pool Details:`);
    console.log(`  - ${ethers.formatEther(amount0)} mETH`);
    console.log(`  - ${ethers.formatEther(amount1)} mUSDC`);
    console.log(`  - Initial price: ~$${(Number(ethers.formatEther(amount1)) / Number(ethers.formatEther(amount0))).toFixed(2)} per mETH`);
    console.log(`  - K parameter: ${ethers.formatEther(k)} (liquidity depth)`);
    console.log(`\n💡 Next steps:`);
    console.log(`  1. Check oracle price is up-to-date`);
    console.log(`  2. Execute test swap to verify the pool works`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


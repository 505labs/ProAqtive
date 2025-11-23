// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to ship liquidity to Aqua using SmartYieldVault
 * 
 * This script handles the complete workflow (matching test flow):
 * 1. Transfers tokens directly to vault
 * 2. Approves Aqua to spend tokens from the vault (owner function)
 * 3. Pre-deposits tokens to Aave (critical for hook withdrawals during swaps)
 * 4. Ships remaining liquidity using the vault as maker (owner function)
 * 5. Supplies any remaining tokens to Aave for yield (owner function)
 * 
 * Note: User must be the vault owner to execute this script.
 * 
 * Usage:
 *   TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 ORDER_FILE=vault-order.json npx hardhat run scripts/ship-liquidity-vault.ts --network sepolia
 * 
 * Or build order on the fly:
 *   TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 npx hardhat run scripts/ship-liquidity-vault.ts --network sepolia
 * 
 * Optional: Control pre-deposit percentage (default 50%):
 *   PRE_DEPOSIT_PERCENTAGE=0.5 TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 npx hardhat run scripts/ship-liquidity-vault.ts --network sepolia
 * 
 * Note: Pre-depositing tokens to Aave BEFORE shipping liquidity ensures the vault has
 * tokens available for withdrawal during swaps (via preTransferOut hook). This matches
 * the test flow and is critical for swaps to succeed on testnet.
 */

import { ethers } from "hardhat";
import {
    getDeployedContract,
    waitForTx,
    displayBalance,
    parseTokenAmount,
    getDeployedAddress,
    formatTokenAmount,
    getOrderConfig,
    getDefaultTokens,
    waitForPendingTransactions
} from "./utils/helpers";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { SmartYieldVault } from "../typechain-types/contracts/SmartYieldVault.sol/SmartYieldVault";
import { MockAavePool } from "../typechain-types/contracts/mocks/MockAavePool";
import * as fs from "fs";

async function main() {
    console.log("=== Shipping Liquidity to Aqua via SmartYieldVault ===\n");

    // Get signers
    const [user] = await ethers.getSigners();
    const userAddress = await user.getAddress();
    console.log(`User address: ${userAddress}\n`);

    // Get deployed contracts
    const vault = await getDeployedContract<SmartYieldVault>("SmartYieldVault");
    const vaultAddress = await vault.getAddress();
    console.log(`Vault: ${vaultAddress}`);
    const aqua = await getDeployedContract<Aqua>("Aqua");
    const swapVM = await getDeployedContract<CustomSwapVMRouter>("CustomSwapVMRouter");
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");

    // // Try to get MockAavePool (for balance checking, optional)
    // let mockAavePool: MockAavePool | null = null;
    // try {
    //     mockAavePool = await getDeployedContract;
    // } catch (e) {
    //     // MockAavePool might not be deployed in production, that's okay
    // }

    // Get token addresses from environment or use defaults from config
    const defaultTokens = getDefaultTokens();
    const token0Address = process.env.TOKEN0 || defaultTokens.USDC;
    const token1Address = process.env.TOKEN1 || defaultTokens.DAI;

    if (!token0Address || !token1Address) {
        throw new Error("TOKEN0 and TOKEN1 environment variables are required");
    }

    const token0 = await ethers.getContractAt("IERC20", token0Address) as any;
    const token1 = await ethers.getContractAt("IERC20", token1Address) as any;

    // Get token amounts
    const amount0 = parseTokenAmount(process.env.AMOUNT0 || "100", 6);
    const amount1 = parseTokenAmount(process.env.AMOUNT1 || "200", 18);

    console.log("Configuration:");
    console.log(`  Vault: ${vaultAddress}`);
    console.log(`  Token0: ${token0Address}`);
    console.log(`  Token1: ${token1Address}`);
    console.log(`  Amount0: ${amount0}`);
    console.log(`  Amount1: ${amount1}\n`);

    // Step 1: Check user balances
    console.log("Step 1: Checking user balances...");
    await displayBalance(token0, userAddress, "User Token0", 6);
    await displayBalance(token1, userAddress, "User Token1");

    const userBalance0 = await token0.balanceOf(userAddress);
    const userBalance1 = await token1.balanceOf(userAddress);

    if (userBalance0 < amount0) {
        throw new Error(`Insufficient Token0 balance: have ${userBalance0.toString()}, need ${amount0.toString()}`);
    }
    if (userBalance1 < amount1) {
        throw new Error(`Insufficient Token1 balance: have ${userBalance1.toString()}, need ${amount1.toString()}`);
    }

    // Step 2: Transfer tokens directly to vault (matching test flow)
    console.log("\nStep 2: Transferring tokens to vault...");

    // Check if user is the owner (required for subsequent operations)
    const vaultOwner = await vault.owner();
    if (userAddress.toLowerCase() !== vaultOwner.toLowerCase()) {
        throw new Error(`User is not the vault owner (owner: ${vaultOwner}). Owner privileges required for shipping liquidity.`);
    }

    // Transfer tokens directly to vault (like the test mints to vault)
    // Wait for any pending transactions first to avoid nonce conflicts
    await waitForPendingTransactions(userAddress, ethers.provider);

    console.log(`  Transferring ${formatTokenAmount(amount0)} Token0 to vault...`);
    const transferTx0 = await token0.connect(user).transfer(vaultAddress, amount0);
    await waitForTx(transferTx0, "Transfer Token0 to Vault");

    // Wait for any pending transactions before next transfer
    await waitForPendingTransactions(userAddress, ethers.provider);

    console.log(`  Transferring ${formatTokenAmount(amount1)} Token1 to vault...`);
    const transferTx1 = await token1.connect(user).transfer(vaultAddress, amount1);
    await waitForTx(transferTx1, "Transfer Token1 to Vault");

    console.log("  ✅ Tokens transferred to vault");

    // Verify vault received tokens
    const vaultBalance0 = await token0.balanceOf(vaultAddress);
    const vaultBalance1 = await token1.balanceOf(vaultAddress);
    console.log(`  Vault Token0 balance: ${formatTokenAmount(vaultBalance0)}`);
    console.log(`  Vault Token1 balance: ${formatTokenAmount(vaultBalance1)}`);

    // Step 3: Approve Aqua to pull tokens from vault (requires owner)
    console.log("\nStep 3: Approving Aqua to spend tokens from vault...");
    const aquaAddress = await aqua.getAddress();

    // Approve Aqua (0 = unlimited approval)
    await waitForPendingTransactions(userAddress, ethers.provider);

    const approveAquaTx0 = await vault.connect(user).approveAqua(token0Address, aquaAddress);
    await waitForTx(approveAquaTx0, "Approve Aqua for Token0 from Vault");

    await waitForPendingTransactions(userAddress, ethers.provider);

    const approveAquaTx1 = await vault.connect(user).approveAqua(token1Address, aquaAddress);
    await waitForTx(approveAquaTx1, "Approve Aqua for Token1 from Vault");

    console.log("  ✅ Aqua approved to spend tokens from vault");

    // Step 3.5: Pre-deposit some tokens to Aave (matching test flow)
    // This ensures vault has tokens in Aave that can be withdrawn during swaps
    // The test pre-deposits 5000 tokens, but we'll use a percentage or fixed amount
    const preDepositPercentage = process.env.PRE_DEPOSIT_PERCENTAGE ? parseFloat(process.env.PRE_DEPOSIT_PERCENTAGE) : 0.5; // 50% by default
    const preDepositAmount0 = amount0 * BigInt(Math.floor(preDepositPercentage * 1e6)) / 1000000n;
    const preDepositAmount1 = amount1 * BigInt(Math.floor(preDepositPercentage * 1e6)) / 1000000n;

    console.log("\nStep 3.5: Pre-depositing tokens to Aave (for hook withdrawals)...");
    console.log(`  Pre-deposit percentage: ${(preDepositPercentage * 100).toFixed(1)}%`);
    console.log(`  This ensures vault has tokens in Aave that can be withdrawn during swaps`);

    if (preDepositAmount0 > 0) {
        await waitForPendingTransactions(userAddress, ethers.provider);
        console.log(`  Pre-depositing ${formatTokenAmount(preDepositAmount0, 6)} Token0 to Aave...`);
        const preDepositTx0 = await vault.connect(user).supplyToAave(token0Address, preDepositAmount0);
        await waitForTx(preDepositTx0, "Pre-deposit Token0 to Aave");
    }

    if (preDepositAmount1 > 0) {
        await waitForPendingTransactions(userAddress, ethers.provider);
        console.log(`  Pre-depositing ${formatTokenAmount(preDepositAmount1)} Token1 to Aave...`);
        const preDepositTx1 = await vault.connect(user).supplyToAave(token1Address, preDepositAmount1);
        await waitForTx(preDepositTx1, "Pre-deposit Token1 to Aave");
    }

    console.log("  ✅ Pre-deposit complete - vault now has tokens in Aave for hook withdrawals");

    // Update amounts for shipping (subtract what was pre-deposited)
    const remainingAmount0 = amount0 - preDepositAmount0;
    const remainingAmount1 = amount1 - preDepositAmount1;

    console.log(`\n  Remaining amounts for shipping to Aqua:`);
    console.log(`    Token0: ${formatTokenAmount(remainingAmount0, 6)} (${formatTokenAmount(amount0, 6)} - ${formatTokenAmount(preDepositAmount0, 6)})`);
    console.log(`    Token1: ${formatTokenAmount(remainingAmount1)} (${formatTokenAmount(amount1)} - ${formatTokenAmount(preDepositAmount1)})`);

    // Step 4: Build or load order
    console.log("\nStep 4: Building/loading order...");
    let order;
    const orderFilePath = process.env.ORDER_FILE || "vault-order.json";

    if (orderFilePath && fs.existsSync(orderFilePath)) {
        console.log(`  Loading order from ${orderFilePath}...`);
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
        order = {
            maker: orderData.maker,
            traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : BigInt(orderData.traits),
            data: orderData.data
        };

        // Verify the order is for this vault
        if (order.maker.toLowerCase() !== vaultAddress.toLowerCase()) {
            throw new Error(`Order maker (${order.maker}) does not match vault address (${vaultAddress})`);
        }
    } else {
        console.log("  Building new order with hooks...");

        // Load configuration from config.json (with env var overrides)
        const orderConfig = getOrderConfig();
        let pythOracle = orderConfig.pythOracle;

        // Try to auto-detect MockPyth if not provided
        if (!pythOracle || pythOracle === "0x0000000000000000000000000000000000000000") {
            try {
                const mockPythAddress = await getDeployedAddress("MockPyth");
                if (mockPythAddress && mockPythAddress !== "") {
                    console.log(`  Auto-detected MockPyth: ${mockPythAddress}`);
                    pythOracle = mockPythAddress;
                }
            } catch (e) {
                // Ignore
            }
        }

        if (!pythOracle || pythOracle === "0x0000000000000000000000000000000000000000") {
            throw new Error("PYTH_ORACLE must be set. Deploy MockPyth or set PYTH_ORACLE environment variable");
        }

        const { priceId, k, maxStaleness, isTokenInBase, baseDecimals, quoteDecimals } = orderConfig;

        // Build order with hooks enabled
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

        const orderResult = await proAquativeAMM.getFunction("buildProgram(address,address,bytes32,uint64,uint64,bool,uint8,uint8,(bool,bool,bool,bool,address,address,address,address,bytes,bytes,bytes,bytes))")(
            vaultAddress,
            pythOracle,
            priceId,
            k,
            maxStaleness,
            isTokenInBase,
            baseDecimals,
            quoteDecimals,
            hookConfig
        );

        order = {
            maker: orderResult.maker,
            traits: orderResult.traits,
            data: orderResult.data
        };

        console.log("  ✅ Order built with hooks enabled");

        // Save order to file for use in execute-swap.ts
        const orderToSave = {
            maker: order.maker,
            traits: order.traits.toString(),
            data: order.data
        };
        fs.writeFileSync(orderFilePath, JSON.stringify(orderToSave, null, 2));
        console.log(`  💾 Order saved to ${orderFilePath} for use in execute-swap.ts`);
    }

    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };
    const orderHash = await swapVM.hash(orderStruct);
    console.log(`\n   📊 Order Hash (calculated in ship-liquidity-vault): ${orderHash}`);
    console.log(`   💡 Use ORDER_FILE=${orderFilePath} in execute-swap.ts to ensure matching order hash`);

    // Step 5: Ship liquidity
    console.log("\nStep 5: Shipping liquidity to Aqua...");
    const swapVMAddress = await swapVM.getAddress();
    const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address maker, uint256 traits, bytes data)"],
        [orderStruct]
    );

    // Wait for any pending transactions before shipping
    await waitForPendingTransactions(userAddress, ethers.provider);

    // Use the vault's shipLiquidity function (user is already verified as owner in Step 2)
    // Ship the remaining amounts (after pre-deposit to Aave)
    const shipTx = await vault.connect(user).shipLiquidity(
        aquaAddress,
        swapVMAddress,
        encodedOrder,
        [token0Address, token1Address],
        [remainingAmount0, remainingAmount1]
    );

    await waitForTx(shipTx, "Ship liquidity via vault");

    console.log("  ✅ Liquidity shipped successfully");

    // Step 6: Supply remaining tokens to Aave (matching test flow)
    console.log("\nStep 6: Supplying remaining tokens to Aave...");

    const vaultBalance0After = await token0.balanceOf(vaultAddress);
    const vaultBalance1After = await token1.balanceOf(vaultAddress);

    if (vaultBalance0After > 0) {
        await waitForPendingTransactions(userAddress, ethers.provider);

        console.log(`  Supplying ${formatTokenAmount(vaultBalance0After, 6)} Token0 to Aave...`);
        const supplyTx0 = await vault.connect(user).supplyToAave(token0Address, vaultBalance0After);
        await waitForTx(supplyTx0, "Supply Token0 to Aave");
    } else {
        console.log("  No remaining Token0 to supply");
    }

    if (vaultBalance1After > 0) {
        await waitForPendingTransactions(userAddress, ethers.provider);

        console.log(`  Supplying ${formatTokenAmount(vaultBalance1After)} Token1 to Aave...`);
        const supplyTx1 = await vault.connect(user).supplyToAave(token1Address, vaultBalance1After);
        await waitForTx(supplyTx1, "Supply Token1 to Aave");
    } else {
        console.log("  No remaining Token1 to supply");
    }

    console.log("  ✅ Remaining tokens supplied to Aave");

    // Final status
    console.log("\n=== Final Status ===");
    const directBalance0 = await token0.balanceOf(vaultAddress);
    const directBalance1 = await token1.balanceOf(vaultAddress);

    console.log(`Token0:`);
    console.log(`  Direct balance: ${formatTokenAmount(directBalance0)}`);

    console.log(`Token1:`);
    console.log(`  Direct balance: ${formatTokenAmount(directBalance1)}`);

    // // Try to get Aave balances if MockAavePool is available
    // if (mockAavePool) {
    //     try {
    //         const aaveBalance0 = await mockAavePool.getBalance(vaultAddress, token0Address);
    //         const aaveBalance1 = await mockAavePool.getBalance(vaultAddress, token1Address);
    //         const totalBalance0 = directBalance0 + aaveBalance0;
    //         const totalBalance1 = directBalance1 + aaveBalance1;

    //         console.log(`Token0:`);
    //         console.log(`  Aave balance: ${formatTokenAmount(aaveBalance0)}`);
    //         console.log(`  Total balance: ${formatTokenAmount(totalBalance0)}`);

    //         console.log(`Token1:`);
    //         console.log(`  Aave balance: ${formatTokenAmount(aaveBalance1)}`);
    //         console.log(`  Total balance: ${formatTokenAmount(totalBalance1)}`);
    //     } catch (e) {
    //         console.log("  (Aave balance check skipped)");
    //     }
    // } else {
    //     console.log("  (Aave balance check skipped - MockAavePool not available)");
    // }

    console.log("\n✅ Complete! Vault is now providing liquidity on Aqua with idle funds in Aave.");
    console.log("\n💡 Next steps:");
    console.log("  - Execute swaps: ORDER_FILE=vault-order.json npx hardhat run scripts/execute-swap.ts --network sepolia");
    console.log("  - Hooks will automatically manage Aave deposits/withdrawals during swaps");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


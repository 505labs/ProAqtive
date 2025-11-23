// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to execute a swap using ProAquativeAMM
 * 
 * Usage:
 *   # Recommended: Use ORDER_FILE to ensure order hash matches the one used when shipping liquidity
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 ORDER_FILE=vault-order.json npx hardhat run scripts/execute-swap.ts --network sepolia
 * 
 *   # Or build order on the fly (will auto-detect SmartYieldVault and use hooks if needed):
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 MAKER_ADDRESS=0x... PYTH_ORACLE=0x... npx hardhat run scripts/execute-swap.ts --network sepolia
 * 
 * Note: When using SmartYieldVault, always use ORDER_FILE=vault-order.json to ensure the order hash matches!
 */

import { ethers } from "hardhat";
import { getDeployedContract, waitForTx, displayBalance, parseTokenAmount, formatTokenAmount, getDefaultTokens, getOrderConfig, getPriceId } from "./utils/helpers";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
// IERC20 interface - using ethers.getContractAt instead of importing
import * as fs from "fs";
import * as path from "path";
import { getQuote } from "./utils/get-quote";

async function main() {
    console.log("=== Executing Swap ===\n");

    // Get signers
    const [taker] = await ethers.getSigners();
    const takerAddress = await taker.getAddress();
    console.log(`Taker address: ${takerAddress}\n`);

    // Get deployed contracts
    const swapVM = await getDeployedContract<CustomSwapVMRouter>("CustomSwapVMRouter");
    const proAquativeAMM = await getDeployedContract<ProAquativeAMM>("ProAquativeAMM");
    const aqua = await getDeployedContract<Aqua>("Aqua");

    // Get token addresses from config
    const defaultTokens = getDefaultTokens();
    const tokenInAddress = process.env.TOKEN_IN || defaultTokens.USDC;
    const tokenOutAddress = process.env.TOKEN_OUT || defaultTokens.DAI;

    if (!tokenInAddress || !tokenOutAddress) {
        throw new Error("TOKEN_IN and TOKEN_OUT environment variables are required");
    }

    const tokenIn = await ethers.getContractAt("IERC20", tokenInAddress) as any;
    const tokenOut = await ethers.getContractAt("IERC20", tokenOutAddress) as any;

    // Get amount
    const amountIn = parseTokenAmount(process.env.AMOUNT_IN || "10");
    const threshold = process.env.THRESHOLD ? parseTokenAmount(process.env.THRESHOLD) : 0n;

    console.log("Swap Configuration:");
    console.log(`  Token In: ${tokenInAddress}`);
    console.log(`  Token Out: ${tokenOutAddress}`);
    console.log(`  Amount In: ${formatTokenAmount(amountIn)}`);
    console.log(`  Min Output (threshold): ${formatTokenAmount(threshold)}\n`);

    // Check balances before
    console.log("Balances before swap:");
    await displayBalance(tokenIn, takerAddress, "TokenIn balance");
    await displayBalance(tokenOut, takerAddress, "TokenOut balance");

    // Build or load order
    let order;

    // Try to determine the correct order file:
    // 1. Use ORDER_FILE env var if set
    // 2. Try vault-order.json (used by ship-liquidity-vault.ts)
    // 3. Fall back to order.json
    let orderFilePath = process.env.ORDER_FILE;
    if (!orderFilePath) {
        if (fs.existsSync("vault-order.json")) {
            orderFilePath = "vault-order.json";
            console.log(`\n📂 Auto-detected vault-order.json (from ship-liquidity-vault.ts)`);
        } else if (fs.existsSync("order.json")) {
            orderFilePath = "order.json";
            console.log(`\n📂 Auto-detected order.json`);
        } else {
            orderFilePath = "order.json"; // Default, will build new order
        }
    }

    if (orderFilePath && fs.existsSync(orderFilePath)) {
        console.log(`\n📂 Loading order from ${orderFilePath}...`);
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, "utf-8"));
        order = {
            maker: orderData.maker,
            traits: typeof orderData.traits === 'string' ? BigInt(orderData.traits) : BigInt(orderData.traits),
            data: orderData.data
        };
        console.log(`   ✅ Order loaded: maker=${order.maker}`);
    } else {
        console.log(`\n🔨 Building new order (${orderFilePath} not found)...`);
        let makerAddress = process.env.MAKER_ADDRESS || takerAddress; // Use taker as maker if not specified

        // Check if maker is a SmartYieldVault (has hooks enabled)
        // This ensures the order hash matches the one used when shipping liquidity
        let useHooks = false;
        let vaultAddress: string | null = null;

        // First, try to get deployed SmartYieldVault address
        try {
            const { getDeployedAddress } = await import("./utils/helpers");
            vaultAddress = await getDeployedAddress("SmartYieldVault");
            if (vaultAddress && vaultAddress !== "") {
                console.log(`   📍 Auto-detected deployed SmartYieldVault: ${vaultAddress}`);
                // If maker is not set, use vault as maker
                if (!process.env.MAKER_ADDRESS) {
                    makerAddress = vaultAddress;
                    console.log(`   ✅ Using vault as maker: ${makerAddress}`);
                }
                // If maker matches vault, use hooks
                if (makerAddress.toLowerCase() === vaultAddress.toLowerCase()) {
                    useHooks = true;
                    console.log(`   ✅ Maker matches vault, will build order with hooks`);
                }
            }
        } catch (e: any) {
            // Vault might not be deployed, continue with other checks
            console.log(`   ℹ️  Could not auto-detect SmartYieldVault: ${e.message || e}`);
        }

        // If still not determined, try to check if maker address is a SmartYieldVault
        if (!useHooks) {
            try {
                const vault = await ethers.getContractAt("SmartYieldVault", makerAddress) as any;
                // If we can read the owner, it's likely a SmartYieldVault
                try {
                    await vault.owner();
                    useHooks = true;
                    console.log(`   ✅ Detected SmartYieldVault at ${makerAddress}, will build order with hooks`);
                } catch (e) {
                    // Not a SmartYieldVault, continue without hooks
                    console.log(`   ℹ️  Maker is not a SmartYieldVault, building order without hooks`);
                }
            } catch (e) {
                // Couldn't determine if it's a vault, check VAULT_ADDRESS env var
                const envVaultAddress = process.env.VAULT_ADDRESS;
                if (envVaultAddress && envVaultAddress.toLowerCase() === makerAddress.toLowerCase()) {
                    useHooks = true;
                    console.log(`   ✅ VAULT_ADDRESS matches maker, will build order with hooks`);
                } else {
                    console.log(`   ℹ️  Building order without hooks (use VAULT_ADDRESS env var or set MAKER_ADDRESS to vault to enable hooks)`);
                }
            }
        }

        // Get order configuration from config
        const orderConfig = getOrderConfig();

        // Get pythOracle from config or env, with auto-detection fallback
        let pythOracle = process.env.PYTH_ORACLE || orderConfig.pythOracle;
        if (!pythOracle || pythOracle === "0x0000000000000000000000000000000000000000") {
            try {
                const { getDeployedAddress } = await import("./utils/helpers");
                const mockPythAddress = await getDeployedAddress("MockPyth");
                if (mockPythAddress && mockPythAddress !== "") {
                    console.log(`   📍 Auto-detected MockPyth: ${mockPythAddress}`);
                    pythOracle = mockPythAddress;
                } else {
                    pythOracle = "0x0000000000000000000000000000000000000000";
                    console.log("   ⚠️  PYTH_ORACLE not set and MockPyth not found");
                    console.log("   💡 Deploy MockPyth first: npx hardhat deploy --tags MockPyth --network sepolia");
                }
            } catch (e: any) {
                pythOracle = "0x0000000000000000000000000000000000000000";
                console.log(`   ⚠️  Error during MockPyth auto-detection: ${e.message || e}`);
            }
        } else {
            console.log(`   ✅ Using PYTH_ORACLE: ${pythOracle}`);
        }

        // Get order parameters from config (env vars override config)
        const priceId = process.env.PRICE_ID ? getPriceId(process.env.PRICE_ID) : getPriceId(orderConfig.priceId);
        const k = process.env.K ? BigInt(process.env.K) : orderConfig.k;
        const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : orderConfig.maxStaleness;
        const isTokenInBase = process.env.IS_TOKEN_IN_BASE !== undefined
            ? process.env.IS_TOKEN_IN_BASE !== "false"
            : orderConfig.isTokenInBase;
        const baseDecimals = process.env.BASE_DECIMALS ? parseInt(process.env.BASE_DECIMALS) : orderConfig.baseDecimals;
        const quoteDecimals = process.env.QUOTE_DECIMALS ? parseInt(process.env.QUOTE_DECIMALS) : orderConfig.quoteDecimals;

        if (pythOracle === "0x0000000000000000000000000000000000000000") {
            console.error("\n❌ ERROR: PYTH_ORACLE is zero address!");
            console.error("   ProAquativeMM requires a valid Pyth oracle address.");
            console.error("\n   Solutions:");
            console.error("   1. Deploy MockPyth: npx hardhat deploy --tags MockPyth --network sepolia");
            console.error("   2. Set PYTH_ORACLE env var: PYTH_ORACLE=0x... npx hardhat run scripts/execute-swap.ts --network sepolia");
            console.error("   3. Use ORDER_FILE to load the order used when shipping liquidity");
            throw new Error("PYTH_ORACLE must be set to a valid address");
        }

        let orderResult;
        if (useHooks) {
            // Build order with hooks (matching ship-liquidity-vault.ts)
            const hookConfig = {
                hasPreTransferInHook: false,
                hasPostTransferInHook: true,
                hasPreTransferOutHook: true,
                hasPostTransferOutHook: false,
                preTransferInTarget: ethers.ZeroAddress,
                postTransferInTarget: makerAddress,
                preTransferOutTarget: makerAddress,
                postTransferOutTarget: ethers.ZeroAddress,
                preTransferInData: "0x",
                postTransferInData: "0x",
                preTransferOutData: "0x",
                postTransferOutData: "0x"
            };

            orderResult = await proAquativeAMM.getFunction("buildProgram(address,address,bytes32,uint64,uint64,bool,uint8,uint8,(bool,bool,bool,bool,address,address,address,address,bytes,bytes,bytes,bytes))")(
                makerAddress,
                pythOracle,
                priceId,
                k,
                maxStaleness,
                isTokenInBase,
                baseDecimals,
                quoteDecimals,
                hookConfig
            );
            console.log("   ✅ Order built with hooks enabled");
        } else {
            // Build order without hooks
            orderResult = await (proAquativeAMM as any).buildProgram(
                makerAddress,
                pythOracle,
                priceId,
                k,
                maxStaleness,
                isTokenInBase,
                baseDecimals,
                quoteDecimals
            );
            console.log("   ✅ Order built without hooks");
        }

        order = {
            maker: orderResult.maker,
            traits: orderResult.traits,
            data: orderResult.data
        };
    }

    // Log order details for debugging
    console.log("\n📋 Order Details:");
    console.log(`   Maker: ${order.maker}`);
    console.log(`   Traits: ${order.traits.toString()}`);
    console.log(`   Data length: ${order.data.length} bytes`);
    console.log(`   Data (hex, first 100 chars): ${order.data.slice(0, 100)}...`);

    // Check if order has hooks enabled by examining traits
    // Hook flags are in the traits: bits 248-251 for hooks
    const traitsValue = BigInt(order.traits);
    const hasPostTransferInHook = (traitsValue & (1n << 248n)) !== 0n;
    const hasPreTransferOutHook = (traitsValue & (1n << 249n)) !== 0n;
    const hasPreTransferInHook = (traitsValue & (1n << 250n)) !== 0n;
    const hasPostTransferOutHook = (traitsValue & (1n << 251n)) !== 0n;

    console.log(`\n   🔍 Hook Status:`);
    console.log(`      PreTransferIn: ${hasPreTransferInHook ? '✅' : '❌'}`);
    console.log(`      PostTransferIn: ${hasPostTransferInHook ? '✅' : '❌'}`);
    console.log(`      PreTransferOut: ${hasPreTransferOutHook ? '✅' : '❌'}`);
    console.log(`      PostTransferOut: ${hasPostTransferOutHook ? '✅' : '❌'}`);

    // Check if maker is a vault and warn if hooks are missing
    try {
        const { getDeployedAddress } = await import("./utils/helpers");
        const vaultAddress = await getDeployedAddress("SmartYieldVault");
        if (vaultAddress && vaultAddress.toLowerCase() === order.maker.toLowerCase()) {
            if (!hasPostTransferInHook || !hasPreTransferOutHook) {
                console.log(`\n   ⚠️  WARNING: Order maker is a SmartYieldVault but hooks are not enabled!`);
                console.log(`      This order hash will NOT match the one from ship-liquidity-vault.ts`);
                console.log(`      💡 Solution: Use ORDER_FILE=vault-order.json to load the correct order`);
            } else {
                console.log(`   ✅ Order has hooks enabled (matches ship-liquidity-vault.ts)`);
            }
        }
    } catch (e) {
        // Ignore errors in vault detection
    }

    const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

    // Calculate order hash for comparison
    const orderHashBeforeQuote = await swapVM.hash(orderStruct);
    console.log(`\n   📊 Order Hash (calculated in execute-swap): ${orderHashBeforeQuote}`);

    // Also log the raw order data to help debug
    console.log(`   Order data (full hex): ${order.data}`);

    // Check allowance
    const allowance = await tokenIn.allowance(takerAddress, await swapVM.getAddress());
    if (allowance < amountIn) {
        console.log("\n⚠️  Allowance insufficient, approving...");
        const approveTx = await tokenIn.connect(taker).approve(await swapVM.getAddress(), ethers.MaxUint256);
        await waitForTx(approveTx, "Approve TokenIn");
    }

    // Get quote first (required before swap)
    console.log("\n📊 Getting quote...");
    const quoteResult = await getQuote({
        swapVM,
        proAquativeAMM,
        aqua,
        tokenInAddress,
        tokenOutAddress,
        amountIn,
        order: order,
        takerAddress,
        isExactIn: true,
        threshold: threshold,
        checkLiquidity: true,
        checkOracle: true
    });



    // Compare order hashes
    console.log(`\n   Order Hash (from getQuote): ${quoteResult.orderHash}`);
    if (orderHashBeforeQuote !== quoteResult.orderHash && quoteResult.success) {
        console.error(`\n   ⚠️  WARNING: Order hash mismatch!`);
        console.error(`      Before getQuote: ${orderHashBeforeQuote}`);
        console.error(`      From getQuote: ${quoteResult.orderHash}`);
        console.error(`   💡 This indicates the order used in getQuote is different from the one in execute-swap`);
        console.error(`   💡 This will cause the swap to fail!`);
    } else if (quoteResult.success) {
        console.log(`   ✅ Order hashes match!`);
    }

    if (!quoteResult.success) {
        console.error("  ❌ Failed to get quote:");
        console.error(`     Error: ${quoteResult.error || "Unknown error"}`);

        console.log("\n  🔍 Troubleshooting:");

        // Check if error is "Price too stale"
        const errorMessage = quoteResult.error || "";
        if (errorMessage.includes("stale") || errorMessage.includes("Price too stale")) {
            console.log("     ⚠️  ERROR: Price is too stale!");
            console.log("     💡 The Pyth oracle price is older than maxStaleness");
            console.log("\n     Solutions:");
            console.log("     1. Update the price in MockPyth:");
            console.log("        npx hardhat run scripts/update-pyth-price.ts --network sepolia");
            console.log("     2. Or increase maxStaleness when building order:");
            console.log("        MAX_STALENESS=7200 npx hardhat run scripts/build-order.ts --network sepolia");
            console.log("");
        }

        console.log("     1. Check if liquidity has been shipped:");
        console.log("        - Run: npx hardhat run scripts/ship-liquidity.ts --network sepolia");
        console.log("     2. Verify the order matches the shipped liquidity:");
        console.log("        - Use ORDER_FILE to ensure same order");
        console.log("     3. Check oracle has fresh price:");
        console.log("        - Run: npx hardhat run scripts/update-pyth-price.ts --network sepolia");
        console.log("     4. Verify token addresses are correct:");
        console.log(`        - TokenIn: ${tokenInAddress}`);
        console.log(`        - TokenOut: ${tokenOutAddress}`);

        console.log("\n  ❌ Cannot proceed with swap - quote failed");
        throw new Error(`Quote failed: ${quoteResult.error || "Unknown error"}`);
    }

    const expectedAmountOut = quoteResult.amountOut;
    console.log(`  ✅ Quote received!`);
    console.log(`     Expected input: ${formatTokenAmount(quoteResult.amountIn)}`);
    console.log(`     Expected output: ${formatTokenAmount(expectedAmountOut)}`);
    console.log(`     Order Hash: ${quoteResult.orderHash}`);

    if (expectedAmountOut < threshold && threshold > 0n) {
        console.log(`  ⚠️  WARNING: Expected output (${formatTokenAmount(expectedAmountOut)}) is below threshold (${formatTokenAmount(threshold)})`);
        console.log(`  💡 Swap will revert if executed with this threshold`);
    }

    // Build taker data for swap
    const { TakerTraitsLib } = await import("../test/utils/SwapVMHelpers");
    const takerData = TakerTraitsLib.build({
        taker: takerAddress,
        isExactIn: true,
        threshold: threshold,
        useTransferFromAndAquaPush: true
    });

    // Execute swap - use the same orderStruct that was used for getQuote
    // IMPORTANT: Use the orderHash from quoteResult to ensure consistency
    console.log("\n🔄 Executing swap...");
    console.log(`   Using order hash: ${quoteResult.orderHash}`);

    // Verify orderStruct matches what was used in getQuote
    const orderHashForSwap = await swapVM.hash(orderStruct);
    if (orderHashForSwap !== quoteResult.orderHash) {
        console.error(`\n   ⚠️  CRITICAL: Order hash mismatch before swap!`);
        console.error(`      Expected (from quote): ${quoteResult.orderHash}`);
        console.error(`      Actual (from orderStruct): ${orderHashForSwap}`);
        console.error(`   💡 The swap will fail because the order hash doesn't match the one used in the quote`);
        throw new Error(`Order hash mismatch: expected ${quoteResult.orderHash}, got ${orderHashForSwap}`);
    }

    // Important: Quote succeeded but swap might fail due to:
    // 1. State changes between quote and swap (hooks modify state)
    // 2. Insufficient balance in vault (hooks need to withdraw from Aave)
    // 3. Hook execution failures

    console.log("\n💡 Note: Quote succeeded, but swap execution may still fail if:");
    console.log("   - Vault balance changed between quote and swap");
    console.log("   - Hooks fail to withdraw from Aave (if using SmartYieldVault)");
    console.log("   - State modifications in hooks cause issues");

    // Try to simulate the swap first to get better error messages
    console.log("\n🔍 Simulating swap (static call) to check for errors...");
    try {
        await swapVM.connect(taker).swap.staticCall(
            orderStruct,
            tokenInAddress,
            tokenOutAddress,
            amountIn,
            takerData
        );
        console.log("   ✅ Simulation successful - swap should execute");
    } catch (simError: any) {
        console.error("   ❌ Simulation failed - this indicates the swap will revert:");
        const simErrorMsg = simError.reason || simError.message || simError.toString() || "";
        console.error(`   Error: ${simErrorMsg}`);

        // Try to decode error data if available
        if (simError.data) {
            console.error(`   Error Data: ${simError.data}`);

            // Check if it's a custom error (starts with 0x and is 4 bytes)
            if (simError.data.length === 10 && simError.data.startsWith("0x")) {
                const errorSelector = simError.data;
                console.error(`   Error Selector: ${errorSelector}`);

                // Common error patterns
                if (errorSelector === "0xf4059071") {
                    console.error("\n   🔍 Decoding error 0xf4059071...");
                    console.error("   This error selector typically indicates:");
                    console.error("   - Insufficient liquidity in the order");
                    console.error("   - Amount requested exceeds available balance");
                    console.error("   - Hook execution failure (if using SmartYieldVault)");
                    console.error("   - Price calculation failure in ProAquativeMM");
                    console.error("\n   💡 Most likely causes:");
                    console.error("   1. Not enough tokens in vault/Aqua for the swap");
                    console.error("   2. Hook failed to withdraw from Aave (if using SmartYieldVault)");
                    console.error("   3. Amount too large relative to available liquidity");
                    console.error("   4. Price staleness or oracle failure");
                }

                // Try to decode using 4byte.directory format
                console.error(`\n   💡 To decode this error selector, visit:`);
                console.error(`   https://www.4byte.directory/signatures/?bytes4_signature=${errorSelector}`);
            }
        }

        // Check if maker is a vault and check its balance
        try {
            const { getDeployedAddress } = await import("./utils/helpers");
            const vaultAddress = await getDeployedAddress("SmartYieldVault");
            if (vaultAddress && order.maker.toLowerCase() === vaultAddress.toLowerCase()) {
                console.log("\n   💡 Detected SmartYieldVault as maker - checking vault balance...");
                const vault = await ethers.getContractAt("SmartYieldVault", vaultAddress) as any;
                const vaultBalanceIn = await tokenIn.balanceOf(vaultAddress);
                const vaultBalanceOut = await tokenOut.balanceOf(vaultAddress);

                console.log(`   Vault ${tokenInAddress} balance: ${formatTokenAmount(vaultBalanceIn)}`);
                console.log(`   Vault ${tokenOutAddress} balance: ${formatTokenAmount(vaultBalanceOut)}`);

                // Check if vault has enough balance for the swap
                console.log(`   Required amountOut (from quote): ${formatTokenAmount(expectedAmountOut)}`);
                if (vaultBalanceOut < expectedAmountOut) {
                    console.error(`   ⚠️  WARNING: Vault may not have enough ${tokenOutAddress} balance!`);
                    console.error(`   💡 The vault may need to withdraw from Aave via hooks`);
                    console.error(`   💡 Or the amount requested is too large for available liquidity`);
                    console.error(`   💡 Current vault balance: ${formatTokenAmount(vaultBalanceOut)}, needed: ${formatTokenAmount(expectedAmountOut)}`);
                } else {
                    console.log(`   ✅ Vault has sufficient balance for swap`);
                }
            }
        } catch (e) {
            // Ignore vault check errors
        }

        console.error("\n   💡 Try these solutions:");
        console.error("   1. Reduce the swap amount (AMOUNT_IN)");
        console.error("   2. Check if liquidity was shipped correctly");
        console.error("   3. Verify the order hash matches the one used when shipping");
        console.error("   4. If using SmartYieldVault, ensure hooks can withdraw from Aave");
        console.error("   5. Update Pyth price if stale");

        throw simError;
    }

    try {
        console.log("\n🔄 Executing swap transaction...");
        const swapTx = await swapVM.connect(taker).swap(
            orderStruct,
            tokenInAddress,
            tokenOutAddress,
            amountIn,
            takerData
        );

        const receipt = await waitForTx(swapTx, "Execute swap");

        // Check balances after
        console.log("\nBalances after swap:");
        await displayBalance(tokenIn, takerAddress, "TokenIn balance");
        await displayBalance(tokenOut, takerAddress, "TokenOut balance");

        // Try to parse swap event if available
        console.log("\n✅ Swap executed successfully!");
        console.log(`   Transaction: ${receipt.hash}`);
        console.log(`   Block: ${receipt.blockNumber}`);
    } catch (error: any) {
        console.error("\n❌ Failed to execute swap:");

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

        // Check if error is "Price too stale"
        const errorMessage = error.message || error.toString() || "";
        if (errorMessage.includes("stale") || errorMessage.includes("Price too stale")) {
            console.log("   ⚠️  ERROR: Price is too stale!");
            console.log("   💡 The Pyth oracle price is older than maxStaleness");
            console.log("\n   Solutions:");
            console.log("   1. Update the price in MockPyth:");
            console.log("      npx hardhat run scripts/update-pyth-price.ts --network sepolia");
            console.log("   2. Or increase maxStaleness when building order:");
            console.log("      MAX_STALENESS=7200 npx hardhat run scripts/build-order.ts --network sepolia");
            console.log("");
        }

        console.log("  1. Check if liquidity has been shipped:");
        console.log("     - Run: npx hardhat run scripts/ship-liquidity.ts --network sepolia");
        console.log("  2. Verify the order matches the shipped liquidity:");
        console.log("     - Use ORDER_FILE to ensure same order");
        console.log("  3. Check token addresses are correct:");
        console.log(`     - TokenIn: ${tokenInAddress}`);
        console.log(`     - TokenOut: ${tokenOutAddress}`);
        console.log("  4. Verify oracle has fresh price:");
        console.log("     - Run: npx hardhat run scripts/update-pyth-price.ts --network sepolia");
        console.log("  5. Check if amount is too large for available liquidity");
        console.log("  6. Verify token approvals:");
        console.log(`     - TokenIn approved to: ${await swapVM.getAddress()}`);

        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


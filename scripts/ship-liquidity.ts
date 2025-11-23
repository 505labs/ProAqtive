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
import { getDeployedContract, waitForTx, displayBalance, parseTokenAmount, getDeployedAddress, formatTokenAmount } from "./utils/helpers";
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { ProAquativeAMM } from "../typechain-types/contracts/ProAquativeAMM";
// IERC20 interface - using ethers.getContractAt instead of importing
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

    const token0 = await ethers.getContractAt("IERC20", token0Address) as any;
    const token1 = await ethers.getContractAt("IERC20", token1Address) as any;

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

    // Verify balances are sufficient
    const balance0 = await token0.balanceOf(makerAddress);
    const balance1 = await token1.balanceOf(makerAddress);

    if (balance0 < amount0) {
        throw new Error(`Insufficient Token0 balance: have ${balance0.toString()}, need ${amount0.toString()}`);
    }
    if (balance1 < amount1) {
        throw new Error(`Insufficient Token1 balance: have ${balance1.toString()}, need ${amount1.toString()}`);
    }

    // Check allowances
    const aquaAddress = await aqua.getAddress();
    const allowance0 = await token0.allowance(makerAddress, aquaAddress);
    const allowance1 = await token1.allowance(makerAddress, aquaAddress);

    console.log("\nAllowances:");
    console.log(`  Token0 allowance: ${allowance0.toString()}`);
    console.log(`  Token1 allowance: ${allowance1.toString()}`);

    // Approve if needed
    if (allowance0 < amount0) {
        console.log("\n⚠️  Token0 allowance insufficient, approving...");
        try {
            const approveTx0 = await token0.connect(maker).approve(aquaAddress, ethers.MaxUint256);
            await waitForTx(approveTx0, "Approve Token0");
        } catch (error: any) {
            throw new Error(`Failed to approve Token0: ${error.message || error}`);
        }
    }

    if (allowance1 < amount1) {
        console.log("\n⚠️  Token1 allowance insufficient, approving...");
        try {
            const approveTx1 = await token1.connect(maker).approve(aquaAddress, ethers.MaxUint256);
            await waitForTx(approveTx1, "Approve Token1");
        } catch (error: any) {
            throw new Error(`Failed to approve Token1: ${error.message || error}`);
        }
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

        // Try to auto-detect MockPyth if not provided
        let pythOracle = process.env.PYTH_ORACLE;
        console.log(`   🔍 Checking PYTH_ORACLE: ${pythOracle || "not set"}`);

        if (!pythOracle || pythOracle === "0x0000000000000000000000000000000000000000") {
            console.log("   🔍 Attempting to auto-detect MockPyth...");
            try {
                // Get the current network name
                const network = await ethers.provider.getNetwork();
                console.log(`   🔍 Checking network: ${network.name} (chainId: ${network.chainId})`);

                const mockPythAddress = await getDeployedAddress("MockPyth");
                console.log(`   🔍 MockPyth deployment lookup result: ${mockPythAddress || "not found"}`);

                if (mockPythAddress && mockPythAddress !== "") {
                    console.log(`   ✅ Auto-detected MockPyth: ${mockPythAddress}`);
                    pythOracle = mockPythAddress;
                } else {
                    pythOracle = "0x0000000000000000000000000000000000000000";
                    console.log("   ⚠️  PYTH_ORACLE not set and MockPyth not found");
                    console.log(`   💡 Deploy MockPyth first: npx hardhat deploy --tags MockPyth --network ${network.name}`);
                    console.log(`   💡 Or set PYTH_ORACLE manually: PYTH_ORACLE=0x... npx hardhat run scripts/ship-liquidity.ts --network ${network.name}`);
                }
            } catch (e: any) {
                console.log(`   ⚠️  Error during auto-detection: ${e.message || e}`);
                pythOracle = "0x0000000000000000000000000000000000000000";
            }
        } else {
            console.log(`   ✅ Using provided PYTH_ORACLE: ${pythOracle}`);
        }

        const priceId = process.env.PRICE_ID || ethers.id("TEST_PRICE_ID");
        const k = process.env.K ? BigInt(process.env.K) : 500000000000000000n;
        const maxStaleness = process.env.MAX_STALENESS ? BigInt(process.env.MAX_STALENESS) : 3600n;
        const isTokenInBase = process.env.IS_TOKEN_IN_BASE !== "false";
        const baseDecimals = parseInt(process.env.BASE_DECIMALS || "18");
        const quoteDecimals = parseInt(process.env.QUOTE_DECIMALS || "18");

        if (pythOracle === "0x0000000000000000000000000000000000000000") {
            console.error("\n❌ ERROR: PYTH_ORACLE is zero address!");
            console.error("   ProAquativeMM requires a valid Pyth oracle address.");
            console.error("\n   Solutions:");
            const network = await ethers.provider.getNetwork();
            console.error(`   1. Deploy MockPyth: npx hardhat deploy --tags MockPyth --network ${network.name}`);
            console.error(`   2. Set PYTH_ORACLE env var: PYTH_ORACLE=0x... npx hardhat run scripts/ship-liquidity.ts --network ${network.name}`);
            console.error(`   3. If MockPyth is already deployed, check the deployment file: deployments/${network.name}/MockPyth.json`);
            throw new Error("PYTH_ORACLE must be set to a valid address");
        }

        console.log(`\n📋 Building order with:`);
        console.log(`   PYTH_ORACLE: ${pythOracle}`);
        console.log(`   PRICE_ID: ${priceId}`);
        console.log(`   K: ${k}`);
        console.log(`   MAX_STALENESS: ${maxStaleness}`);

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

    // Verify order structure
    console.log("\n📋 Order Details:");
    console.log(`  Maker: ${order.maker}`);
    console.log(`  Traits: ${order.traits.toString()}`);
    console.log(`  Data length: ${order.data.length} bytes`);
    console.log(`  Encoded order: ${encodedOrder}`);

    // Verify contracts are deployed
    const swapVMAddress = await swapVM.getAddress();
    console.log(`\n📍 Contract Addresses:`);
    console.log(`  Aqua: ${aquaAddress}`);
    console.log(`  SwapVM: ${swapVMAddress}`);
    console.log(`  ProAquativeAMM: ${await proAquativeAMM.getAddress()}`);

    // Check if strategy hash already exists in Aqua
    console.log("\n🔍 Checking if strategy already exists...");
    try {
        const orderHash = await swapVM.hash(orderStruct);
        console.log(`   Order Hash: ${orderHash}`);

        // Check if strategy hash exists by querying rawBalances
        // If tokensCount > 0 and != _DOCKED (255), the strategy exists
        const [balance0, tokensCount0Raw] = await aqua.rawBalances(
            makerAddress,
            swapVMAddress,
            orderHash,
            token0Address
        );
        const [balance1, tokensCount1Raw] = await aqua.rawBalances(
            makerAddress,
            swapVMAddress,
            orderHash,
            token1Address
        );

        // Convert to numbers for comparison
        const tokensCount0 = Number(tokensCount0Raw);
        const tokensCount1 = Number(tokensCount1Raw);

        console.log(`   Strategy Token0: balance=${formatTokenAmount(balance0)}, tokensCount=${tokensCount0}`);
        console.log(`   Strategy Token1: balance=${formatTokenAmount(balance1)}, tokensCount=${tokensCount1}`);

        // _DOCKED is 255 (0xFF)
        // If tokensCount > 0 (including DOCKED), the strategy hash has been registered
        // Aqua does not allow shipping to the same strategy hash twice, even if docked
        const DOCKED = 255; // _DOCKED constant from Aqua
        const strategyExists = tokensCount0 > 0 || tokensCount1 > 0;
        const isDocked = tokensCount0 === DOCKED || tokensCount1 === DOCKED;

        if (strategyExists) {
            if (isDocked) {
                console.log("\n   ⚠️  ERROR: Strategy hash was previously docked!");
            } else {
                console.log("\n   ⚠️  ERROR: Strategy hash already exists in Aqua!");
            }
            console.log("   ⚠️  Aqua does not allow shipping to the same order twice (StrategiesMustBeImmutable)!");
            console.log("\n   💡 Solutions:");
            console.log("      1. Use different order parameters:");
            console.log("         - Change K: K=600000000000000000 (different k value)");
            console.log("         - Change PRICE_ID: PRICE_ID=0x... (different price feed)");
            console.log("         - Change MAX_STALENESS: MAX_STALENESS=7200");
            console.log("      2. Use a different maker address:");
            console.log("         - MAKER_ADDRESS=0x... (different address)");
            console.log("\n   ❌ Aborting to prevent StrategiesMustBeImmutable error.");
            throw new Error("Strategy hash already exists. Aqua requires unique orders (StrategiesMustBeImmutable)");
        } else {
            console.log("   ✅ Strategy hash not found - safe to ship");
        }
    } catch (checkError: any) {
        if (checkError.message && checkError.message.includes("StrategiesMustBeImmutable")) {
            throw checkError; // Re-throw if it's our intentional error
        }
        // If rawBalances fails, it might mean the strategy doesn't exist (which is fine)
        // But log it for debugging
        console.log(`   ⚠️  Could not check strategy existence: ${checkError.message}`);
        console.log("   💡 Proceeding anyway - if strategy exists, you'll get StrategiesMustBeImmutable error");
    }

    // Ship liquidity
    console.log("\n🚢 Shipping liquidity to Aqua...");
    try {
        const shipTx = await aqua.connect(maker).ship(
            swapVMAddress,
            encodedOrder,
            [token0Address, token1Address],
            [amount0, amount1]
        );

        await waitForTx(shipTx, "Ship liquidity");
    } catch (error: any) {
        console.error("\n❌ Failed to ship liquidity:");

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
        console.log("  1. Verify token balances are sufficient:");
        console.log(`     - Token0: need ${amount0.toString()}`);
        console.log(`     - Token1: need ${amount1.toString()}`);
        console.log("  2. Verify token approvals:");
        console.log(`     - Token0: approved to ${aquaAddress}`);
        console.log(`     - Token1: approved to ${aquaAddress}`);
        console.log("  3. Verify token addresses are correct:");
        console.log(`     - Token0: ${token0Address}`);
        console.log(`     - Token1: ${token1Address}`);
        console.log("  4. Verify contracts are deployed:");
        console.log(`     - Aqua: ${aquaAddress}`);
        console.log(`     - SwapVM: ${swapVMAddress}`);
        console.log("  5. For ProAquativeMM, verify PYTH_ORACLE is set:");
        // Try to get the actual pythOracle that was used (if available in scope)
        let errorPythOracle = process.env.PYTH_ORACLE;
        if (!errorPythOracle || errorPythOracle === "0x0000000000000000000000000000000000000000") {
            try {
                const detected = await getDeployedAddress("MockPyth");
                if (detected && detected !== "") {
                    errorPythOracle = detected;
                }
            } catch (e) {
                // Ignore
            }
        }
        console.log(`     - Oracle: ${errorPythOracle || "0x0000000000000000000000000000000000000000"}`);
        if (!errorPythOracle || errorPythOracle === "0x0000000000000000000000000000000000000000") {
            console.log("     ⚠️  Using zero address - deploy MockPyth first!");
            console.log("     💡 Run: npx hardhat deploy --tags MockPyth --network sepolia");
        }
        console.log("  6. Check if order was already shipped:");
        try {
            const orderHash = await swapVM.hash(orderStruct);
            console.log(`     - Order Hash: ${orderHash}`);
            console.log("     ⚠️  ERROR: StrategiesMustBeImmutable - This order was already shipped!");
            console.log("     💡 Aqua does not allow shipping to the same order twice.");
            console.log("     💡 Solutions:");
            console.log("        1. Use different order parameters:");
            console.log("           - Change K: K=600000000000000000 (different k value)");
            console.log("           - Change PRICE_ID: PRICE_ID=0x... (different price feed)");
            console.log("           - Change MAX_STALENESS: MAX_STALENESS=7200");
            console.log("        2. Use a different maker address:");
            console.log("           - MAKER_ADDRESS=0x... (different address)");
            console.log("        3. Withdraw existing liquidity first (if supported)");
        } catch (e) {
            // Ignore
        }

        throw error;
    }

    // Save order to file for reuse
    const orderHash = ethers.keccak256(encodedOrder);
    const orderToSave = {
        maker: order.maker,
        traits: order.traits.toString(),
        data: order.data
    };

    const saveOrderFile = process.env.SAVE_ORDER_FILE || "order.json";
    fs.writeFileSync(saveOrderFile, JSON.stringify(orderToSave, null, 2));
    console.log(`\n💾 Order saved to: ${saveOrderFile}`);

    // Check balances after
    console.log("\nBalances after shipping:");
    await displayBalance(token0, makerAddress, "Token0 balance");
    await displayBalance(token1, makerAddress, "Token1 balance");

    console.log("\n✅ Liquidity shipped successfully!");
    console.log(`\nOrder hash: ${orderHash}`);
    console.log(`\n💡 To use this order in other scripts:`);
    console.log(`   ORDER_FILE=${saveOrderFile} npx hardhat run scripts/get-quote.ts --network sepolia`);
    console.log(`   ORDER_FILE=${saveOrderFile} npx hardhat run scripts/execute-swap.ts --network sepolia`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


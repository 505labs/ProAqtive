// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Deployment script for SmartYieldVault and order building with hooks enabled
 * 
 * Usage:
 *   # Deploy vault and build order
 *   AAVE_POOL=0x... npx hardhat deploy --tags SmartYieldVault --network sepolia
 * 
 *   # With custom parameters
 *   AQUA_ROUTER=0x... AAVE_POOL=0x... PYTH_ORACLE=0x... npx hardhat deploy --tags SmartYieldVault --network sepolia
 * 
 * Configuration:
 *   - AAVE_POOL: Aave V3 Pool address (required)
 *   - AQUA_ROUTER: CustomSwapVMRouter address (optional, will use deployed if available)
 *   - PYTH_ORACLE: Pyth oracle address (optional, will use default or deployed MockPyth)
 *   - PRICE_ID: Price feed ID (optional, defaults to TEST_PRICE_ID)
 *   - K: k parameter (default: 400000000000000000 = 0.4)
 *   - MAX_STALENESS: Max price age in seconds (default: 7200)
 *   - ORDER_FILE: Output file for order JSON (default: vault-order.json)
 */

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';
import * as fs from 'fs';
import { loadConfig } from '../config/loadConfig';
import { getOrderConfig, getPriceId } from '../scripts/utils/helpers';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('Deploying SmartYieldVault with account:', deployer);

    // Get CustomSwapVMRouter address (required)
    let aquaRouterAddress: string;
    const existingCustomSwapVMRouter = await deployments.getOrNull('CustomSwapVMRouter');
    if (existingCustomSwapVMRouter) {
        aquaRouterAddress = existingCustomSwapVMRouter.address;
        console.log(`Using existing CustomSwapVMRouter at: ${aquaRouterAddress}`);
    } else {
        // Try to get from environment variable
        const envAquaRouter = process.env.AQUA_ROUTER;
        if (envAquaRouter && envAquaRouter !== ethers.ZeroAddress) {
            aquaRouterAddress = envAquaRouter;
            console.log(`Using CustomSwapVMRouter from environment: ${aquaRouterAddress}`);
        } else {
            throw new Error('CustomSwapVMRouter not deployed. Please deploy it first or set AQUA_ROUTER environment variable.');
        }
    }

    // Get Aave Pool address (required) - from config.json or env var
    const config = loadConfig();
    console.log(config);
    const aavePool = config.AAVE_POOL;
    if (!aavePool || aavePool === ethers.ZeroAddress) {
        throw new Error('AAVE_POOL must be set in config.json or AAVE_POOL environment variable');
    }
    console.log(`Aave Pool: ${aavePool}`);

    // Deploy SmartYieldVault
    const smartYieldVaultDeploy = await deploy('SmartYieldVault', {
        from: deployer,
        args: [
            aquaRouterAddress,
            aavePool,
            deployer // owner
        ],
        log: true,
        waitConfirmations: 1,
    });

    const vaultAddress = smartYieldVaultDeploy.address;
    console.log(`SmartYieldVault deployed at: ${vaultAddress}`);

    // Build order with hooks enabled
    console.log('\nBuilding order program with ProAquativeAMM (with hooks)...');

    // Get ProAquativeAMM contract
    const existingProAquativeAMM = await deployments.getOrNull('ProAquativeAMM');
    if (!existingProAquativeAMM) {
        throw new Error('ProAquativeAMM not deployed. Please deploy it first or ensure dependencies are met.');
    }
    const proAquativeAMMAddress = existingProAquativeAMM.address;
    const proAquativeAMM = await ethers.getContractAt('ProAquativeAMM', proAquativeAMMAddress);

    // Configuration for the order program - from config.json (with env var overrides)
    const orderConfig = getOrderConfig();

    // Get pythOracle from env, config, or try to auto-detect MockPyth
    let pythOracle = process.env.PYTH_ORACLE || orderConfig.pythOracle;

    // Check if MockPyth is deployed and use it if pythOracle is not set
    if (!pythOracle || pythOracle === ethers.ZeroAddress) {
        const mockPyth = await deployments.getOrNull('MockPyth');
        if (mockPyth?.address) {
            pythOracle = mockPyth.address;
            console.log(`  Using deployed MockPyth: ${pythOracle}`);
        } else {
            throw new Error('PYTH_ORACLE must be set. Deploy MockPyth first or set PYTH_ORACLE environment variable.');
        }
    }

    const { k, maxStaleness, isTokenInBase, baseDecimals, quoteDecimals } = orderConfig;

    console.log(`  Pyth Oracle: ${pythOracle}`);
    console.log(`  Price ID: ${orderConfig.priceId}`);
    console.log(`  K: ${k}`);
    console.log(`  Max Staleness: ${maxStaleness}`);

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

    // Call the overloaded buildProgram function with hooks
    const orderWithHooks = await proAquativeAMM.getFunction("buildProgram(address,address,bytes32,uint64,uint64,bool,uint8,uint8,(bool,bool,bool,bool,address,address,address,address,bytes,bytes,bytes,bytes))")(
        vaultAddress, // Maker is the vault
        pythOracle,
        orderConfig.priceId,
        k,
        maxStaleness,
        isTokenInBase,
        baseDecimals,
        quoteDecimals,
        hookConfig
    );

    console.log('\n✅ Order built successfully with hooks!');

    // Display order details
    const traitsValue = BigInt(orderWithHooks.traits);
    console.log('\nOrder Details:');
    console.log(`  Maker (Vault): ${orderWithHooks.maker}`);
    console.log(`  Traits (hex): ${orderWithHooks.traits}`);
    console.log(`  Traits (numeric): ${traitsValue.toString()}`);
    console.log(`  Program Length: ${ethers.getBytes(orderWithHooks.data).length} bytes`);
    console.log(`  PreTransferOut Hook: Enabled (target: ${vaultAddress})`);
    console.log(`  PostTransferIn Hook: Enabled (target: ${vaultAddress})`);

    // Show which flags are set
    console.log('\n📋 Enabled Flags:');
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

    // Save order to file for reuse
    const orderToSave = {
        maker: orderWithHooks.maker,
        traits: orderWithHooks.traits.toString(),
        data: orderWithHooks.data
    };

    const orderFilePath = process.env.ORDER_FILE || "vault-order.json";
    fs.writeFileSync(orderFilePath, JSON.stringify(orderToSave, null, 2));
    console.log(`\n💾 Order saved to: ${orderFilePath}`);

    console.log('\n=== SmartYieldVault Deployment Summary ===');
    console.log(`CustomSwapVMRouter: ${aquaRouterAddress}`);
    console.log(`Aave Pool: ${aavePool}`);
    console.log(`SmartYieldVault: ${vaultAddress}`);
    console.log(`Order File: ${orderFilePath}`);
    console.log('==========================================\n');

    console.log('💡 Next Steps:');
    console.log(`   1. The vault is ready to act as a Maker on Aqua`);
    console.log(`   2. Use this order when shipping liquidity:`);
    console.log(`      ORDER_FILE=${orderFilePath} VAULT_ADDRESS=${vaultAddress} npx hardhat run scripts/ship-liquidity.ts --network sepolia`);
    console.log(`   3. The vault will automatically:`);
    console.log(`      - Withdraw from Aave when tokens are needed (preTransferOut)`);
    console.log(`      - Deposit to Aave after receiving tokens (postTransferIn)`);

    // Verify contract if not on localhost
    if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
        console.log('\nWaiting for block confirmations...');
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

        console.log('Verifying SmartYieldVault...');
        try {
            await hre.run('verify:verify', {
                address: vaultAddress,
                constructorArguments: [
                    aquaRouterAddress,
                    aavePool,
                    deployer
                ],
            });
            console.log(`SmartYieldVault verified`);
        } catch (error) {
            console.error('Failed to verify SmartYieldVault:', error);
        }
    }
};

export default func;
func.tags = ['SmartYieldVault'];
func.dependencies = ['ProAquativeAMM', 'CustomSwapVMRouter'];


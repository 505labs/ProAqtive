// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Deployment script for all components needed for SmartYieldVault
 * 
 * This script deploys all necessary contracts in the correct order:
 * 1. Aqua (if not already deployed)
 * 2. CustomSwapVMRouter
 * 3. ProAquativeAMM
 * 4. MockPyth (Oracle)
 * 5. MockAavePool
 * 6. SmartYieldVault
 * 
 * Usage:
 *   # Deploy all components
 *   npx hardhat deploy --tags DeployAll --network sepolia
 * 
 *   # With custom Aave Pool (if not using MockAavePool)
 *   AAVE_POOL=0x... npx hardhat deploy --tags DeployAll --network sepolia
 * 
 * Configuration:
 *   - FORCE_REDEPLOY: Force redeploy all contracts even if they exist (default: false)
 *   - AAVE_POOL: Aave V3 Pool address (optional, will use MockAavePool if not set)
 *   - PYTH_ORACLE: Pyth oracle address (optional, will use MockPyth if not set)
 *   - PRICE_ID: Price feed ID (optional, defaults from config.json)
 *   - K: k parameter (optional, defaults from config.json)
 *   - MAX_STALENESS: Max price age in seconds (optional, defaults from config.json)
 * 
 * Examples:
 *   # Normal deployment (uses existing contracts if found)
 *   npx hardhat deploy --tags DeployAll --network sepolia
 * 
 *   # Force redeploy all contracts (ignores existing deployments)
 *   FORCE_REDEPLOY=true npx hardhat deploy --tags DeployAll --network sepolia
 */

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config/loadConfig';
import { getOrderConfig, getPriceId } from '../scripts/utils/helpers';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('Deploying All Components for SmartYieldVault');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`Deployer account: ${deployer}\n`);

    // Check if force redeploy flag is set
    const forceRedeploy = process.env.FORCE_REDEPLOY === 'true' || process.env.FORCE_REDEPLOY === '1';
    if (forceRedeploy) {
        console.log('⚠️  FORCE_REDEPLOY is enabled - will delete existing deployments and redeploy all contracts\n');

        // Delete existing deployment records to force fresh deployment
        const contractsToDelete = [
            'Aqua',
            'CustomSwapVMRouter',
            'ProAquativeAMM',
            'MockPyth',
            'MockAavePool',
            'SmartYieldVault'
        ];

        for (const contractName of contractsToDelete) {
            try {
                // Delete from deployments registry
                const existing = await deployments.getOrNull(contractName);
                if (existing) {
                    await deployments.delete(contractName);
                    console.log(`  🗑️  Deleted existing deployment record for ${contractName}`);
                }

                // Also delete the deployment file from filesystem to ensure it's completely removed
                const networkName = hre.network.name;
                const deploymentFile = path.join(
                    __dirname,
                    '..',
                    'deployments',
                    networkName,
                    `${contractName}.json`
                );
                if (fs.existsSync(deploymentFile)) {
                    fs.unlinkSync(deploymentFile);
                    console.log(`  🗑️  Deleted deployment file: ${deploymentFile}`);
                }
            } catch (error: any) {
                // Ignore errors if deployment doesn't exist
                if (!error.message?.includes('not found') && !error.message?.includes('ENOENT')) {
                    console.log(`  ⚠️  Could not delete ${contractName}: ${error.message || error}`);
                }
            }
        }
        console.log('');
    }

    // ============================================================================
    // Step 1: Deploy Aqua (if not already deployed)
    // ============================================================================
    console.log('Step 1: Deploying Aqua...');
    let aquaAddress: string;
    const existingAqua = !forceRedeploy ? await deployments.getOrNull('Aqua') : null;
    if (existingAqua) {
        aquaAddress = existingAqua.address;
        console.log(`  ✅ Using existing Aqua at: ${aquaAddress}`);
    } else {
        console.log('  Deploying Aqua...');
        const aquaDeploy = await deploy('Aqua', {
            from: deployer,
            args: [],
            log: true,
            waitConfirmations: 1,
        });
        aquaAddress = aquaDeploy.address;
        console.log(`  ✅ Aqua deployed at: ${aquaAddress}`);
    }

    // ============================================================================
    // Step 2: Deploy CustomSwapVMRouter
    // ============================================================================
    console.log('\nStep 2: Deploying CustomSwapVMRouter...');
    let customSwapVMRouterAddress: string;
    const existingCustomSwapVMRouter = !forceRedeploy ? await deployments.getOrNull('CustomSwapVMRouter') : null;
    if (existingCustomSwapVMRouter) {
        customSwapVMRouterAddress = existingCustomSwapVMRouter.address;
        console.log(`  ✅ Using existing CustomSwapVMRouter at: ${customSwapVMRouterAddress}`);
    } else {
        console.log('  Deploying CustomSwapVMRouter...');
        const customSwapVMRouterDeploy = await deploy('CustomSwapVMRouter', {
            from: deployer,
            args: [
                aquaAddress,
                'CustomSwapVM',
                '1.0.0'
            ],
            log: true,
            waitConfirmations: 1,
        });
        customSwapVMRouterAddress = customSwapVMRouterDeploy.address;
        console.log(`  ✅ CustomSwapVMRouter deployed at: ${customSwapVMRouterAddress}`);
    }

    // ============================================================================
    // Step 3: Deploy ProAquativeAMM
    // ============================================================================
    console.log('\nStep 3: Deploying ProAquativeAMM...');
    let proAquativeAMMAddress: string;
    const existingProAquativeAMM = !forceRedeploy ? await deployments.getOrNull('ProAquativeAMM') : null;
    if (existingProAquativeAMM) {
        proAquativeAMMAddress = existingProAquativeAMM.address;
        console.log(`  ✅ Using existing ProAquativeAMM at: ${proAquativeAMMAddress}`);
    } else {
        console.log('  Deploying ProAquativeAMM...');
        const proAquativeAMMDeploy = await deploy('ProAquativeAMM', {
            from: deployer,
            args: [aquaAddress],
            log: true,
            waitConfirmations: 1,
        });
        proAquativeAMMAddress = proAquativeAMMDeploy.address;
        console.log(`  ✅ ProAquativeAMM deployed at: ${proAquativeAMMAddress}`);
    }

    // ============================================================================
    // Step 4: Deploy MockPyth (Oracle)
    // ============================================================================
    console.log('\nStep 4: Deploying MockPyth (Oracle)...');
    let mockPythAddress: string;
    let mockPythWasNewlyDeployed = false;
    const existingMockPyth = !forceRedeploy ? await deployments.getOrNull('MockPyth') : null;
    if (existingMockPyth) {
        mockPythAddress = existingMockPyth.address;
        console.log(`  ✅ Using existing MockPyth at: ${mockPythAddress}`);
    } else {
        mockPythWasNewlyDeployed = true;
        console.log('  Deploying MockPyth...');
        const mockPythDeploy = await deploy('MockPyth', {
            from: deployer,
            args: [],
            log: true,
            waitConfirmations: 1,
        });
        mockPythAddress = mockPythDeploy.address;
        console.log(`  ✅ MockPyth deployed at: ${mockPythAddress}`);

        // Set initial price if SET_PRICE is not false
        const setPrice = process.env.SET_PRICE !== 'false';
        if (setPrice) {
            console.log('  Setting initial price in MockPyth...');
            const mockPyth = await ethers.getContractAt('MockPyth', mockPythAddress);
            const priceId = process.env.PRICE_ID ? ethers.id(process.env.PRICE_ID) : ethers.id('TEST_PRICE_ID');
            const price = process.env.PRICE ? parseInt(process.env.PRICE) : 200000000; // 2e8
            const exponent = process.env.EXPONENT ? parseInt(process.env.EXPONENT) : -8;
            const confidence = process.env.CONFIDENCE ? BigInt(process.env.CONFIDENCE) : 1000000n;

            try {
                const setPriceTx = await mockPyth.setPrice(priceId, price, confidence, exponent);
                await setPriceTx.wait();
                console.log(`  ✅ Price set: ${price} * 10^${exponent} = ${price * Math.pow(10, exponent)}`);
            } catch (error: any) {
                console.log(`  ⚠️  Failed to set price: ${error.message || error}`);
                console.log('  💡 You can set the price later using update-pyth-price.ts script');
            }
        }
    }

    // ============================================================================
    // Step 5: Deploy MockAavePool
    // ============================================================================
    console.log('\nStep 5: Deploying MockAavePool...');
    let aavePoolAddress: string;
    const useMockAave = !process.env.AAVE_POOL || process.env.AAVE_POOL === ethers.ZeroAddress;

    if (useMockAave) {
        const existingMockAavePool = !forceRedeploy ? await deployments.getOrNull('MockAavePool') : null;
        if (existingMockAavePool) {
            aavePoolAddress = existingMockAavePool.address;
            console.log(`  ✅ Using existing MockAavePool at: ${aavePoolAddress}`);
        } else {
            console.log('  Deploying MockAavePool...');
            const mockAavePoolDeploy = await deploy('MockAavePool', {
                from: deployer,
                args: [],
                log: true,
                waitConfirmations: 1,
            });
            aavePoolAddress = mockAavePoolDeploy.address;
            console.log(`  ✅ MockAavePool deployed at: ${aavePoolAddress}`);
        }
    } else {
        aavePoolAddress = process.env.AAVE_POOL || ethers.ZeroAddress;
        if (aavePoolAddress === ethers.ZeroAddress) {
            throw new Error('AAVE_POOL environment variable is required');
        }
        console.log(`  ✅ Using AAVE_POOL from environment: ${aavePoolAddress}`);
    }

    // ============================================================================
    // Step 6: Deploy SmartYieldVault
    // ============================================================================
    console.log('\nStep 6: Deploying SmartYieldVault...');
    let smartYieldVaultAddress: string;
    const existingSmartYieldVault = !forceRedeploy ? await deployments.getOrNull('SmartYieldVault') : null;
    if (existingSmartYieldVault) {
        smartYieldVaultAddress = existingSmartYieldVault.address;
        console.log(`  ✅ Using existing SmartYieldVault at: ${smartYieldVaultAddress}`);
    } else {
        console.log('  Deploying SmartYieldVault...');
        const smartYieldVaultDeploy = await deploy('SmartYieldVault', {
            from: deployer,
            args: [
                customSwapVMRouterAddress,
                aavePoolAddress,
                deployer // owner
            ],
            log: true,
            waitConfirmations: 1,
        });
        smartYieldVaultAddress = smartYieldVaultDeploy.address;
        console.log(`  ✅ SmartYieldVault deployed at: ${smartYieldVaultAddress}`);
    }

    // ============================================================================
    // Step 7: Build Order with Hooks (optional, can be skipped)
    // ============================================================================
    const buildOrder = process.env.BUILD_ORDER !== 'false';
    if (buildOrder) {
        console.log('\nStep 7: Building order with hooks...');
        try {
            const proAquativeAMM = await ethers.getContractAt('ProAquativeAMM', proAquativeAMMAddress);
            const orderConfig = getOrderConfig();

            // Use MockPyth if pythOracle is not set
            let pythOracle = process.env.PYTH_ORACLE || orderConfig.pythOracle;
            if (!pythOracle || pythOracle === ethers.ZeroAddress) {
                pythOracle = mockPythAddress;
                console.log(`  Using MockPyth as oracle: ${pythOracle}`);
            }

            const { k, maxStaleness, isTokenInBase, baseDecimals, quoteDecimals } = orderConfig;
            const priceId = process.env.PRICE_ID ? getPriceId(process.env.PRICE_ID) : getPriceId(orderConfig.priceId);

            // Build order with hooks enabled
            const hookConfig = {
                hasPreTransferInHook: false,
                hasPostTransferInHook: true,
                hasPreTransferOutHook: true,
                hasPostTransferOutHook: false,
                preTransferInTarget: ethers.ZeroAddress,
                postTransferInTarget: smartYieldVaultAddress,
                preTransferOutTarget: smartYieldVaultAddress,
                postTransferOutTarget: ethers.ZeroAddress,
                preTransferInData: "0x",
                postTransferInData: "0x",
                preTransferOutData: "0x",
                postTransferOutData: "0x"
            };

            const orderResult = await proAquativeAMM.getFunction("buildProgram(address,address,bytes32,uint64,uint64,bool,uint8,uint8,(bool,bool,bool,bool,address,address,address,address,bytes,bytes,bytes,bytes))")(
                smartYieldVaultAddress,
                pythOracle,
                priceId,
                k,
                maxStaleness,
                isTokenInBase,
                baseDecimals,
                quoteDecimals,
                hookConfig
            );

            const order = {
                maker: orderResult.maker,
                traits: orderResult.traits.toString(),
                data: orderResult.data
            };

            const orderFilePath = process.env.ORDER_FILE || 'vault-order.json';
            fs.writeFileSync(orderFilePath, JSON.stringify(order, null, 2));
            console.log(`  ✅ Order built and saved to ${orderFilePath}`);
        } catch (error: any) {
            console.log(`  ⚠️  Failed to build order: ${error.message || error}`);
            console.log('  💡 You can build the order later using ship-liquidity-vault.ts script');
        }
    } else {
        console.log('\nStep 7: Skipping order building (BUILD_ORDER=false)');
    }

    // ============================================================================
    // Deployment Summary
    // ============================================================================
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Deployment Summary');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Aqua:                      ${aquaAddress}`);
    console.log(`CustomSwapVMRouter:        ${customSwapVMRouterAddress}`);
    console.log(`ProAquativeAMM:            ${proAquativeAMMAddress}`);
    console.log(`MockPyth (Oracle):         ${mockPythAddress}`);
    console.log(`Aave Pool:                 ${aavePoolAddress} ${useMockAave ? '(MockAavePool)' : '(External)'}`);
    console.log(`SmartYieldVault:           ${smartYieldVaultAddress}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================================
    // Update config.json with deployed addresses
    // ============================================================================
    console.log('Updating config.json with deployed addresses...');
    try {
        const configPath = path.join(__dirname, '../config/config.json');
        let config: any = {};

        // Load existing config if it exists
        if (fs.existsSync(configPath)) {
            const configFile = fs.readFileSync(configPath, 'utf-8');
            config = JSON.parse(configFile);
        }

        // Update addresses
        config.AAVE_POOL = aavePoolAddress;
        config.VAULT_ADDRESS = smartYieldVaultAddress;

        // Also update PYTH_ORACLE if we deployed MockPyth (and it wasn't set via env var)
        if (mockPythWasNewlyDeployed && (!process.env.PYTH_ORACLE || process.env.PYTH_ORACLE === ethers.ZeroAddress)) {
            config.PYTH_ORACLE = mockPythAddress;
        }

        // Write updated config back to file
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        console.log(`  ✅ Updated config.json:`);
        console.log(`     AAVE_POOL: ${aavePoolAddress}`);
        console.log(`     VAULT_ADDRESS: ${smartYieldVaultAddress}`);
        if (mockPythWasNewlyDeployed && (!process.env.PYTH_ORACLE || process.env.PYTH_ORACLE === ethers.ZeroAddress)) {
            console.log(`     PYTH_ORACLE: ${mockPythAddress}`);
        }
    } catch (error: any) {
        console.log(`  ⚠️  Failed to update config.json: ${error.message || error}`);
        console.log('  💡 You can manually update config.json with the addresses above');
    }

    // ============================================================================
    // Contract Verification (for testnets/mainnet)
    // ============================================================================
    if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
        console.log('Waiting for block confirmations before verification...');
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

        console.log('Verifying contracts on Etherscan...\n');

        // Verify CustomSwapVMRouter
        try {
            const customSwapVM = await deployments.get('CustomSwapVMRouter');
            await hre.run('verify:verify', {
                address: customSwapVM.address,
                constructorArguments: [
                    aquaAddress,
                    'CustomSwapVM',
                    '1.0.0'
                ],
            });
            console.log(`✅ CustomSwapVMRouter verified`);
        } catch (error: any) {
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ CustomSwapVMRouter already verified`);
            } else {
                console.error(`❌ Failed to verify CustomSwapVMRouter: ${error.message || error}`);
            }
        }

        // Verify ProAquativeAMM
        try {
            const proAquativeAMM = await deployments.get('ProAquativeAMM');
            await hre.run('verify:verify', {
                address: proAquativeAMM.address,
                constructorArguments: [aquaAddress],
            });
            console.log(`✅ ProAquativeAMM verified`);
        } catch (error: any) {
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ ProAquativeAMM already verified`);
            } else {
                console.error(`❌ Failed to verify ProAquativeAMM: ${error.message || error}`);
            }
        }

        // Verify MockPyth
        try {
            const mockPyth = await deployments.get('MockPyth');
            await hre.run('verify:verify', {
                address: mockPyth.address,
                constructorArguments: [],
            });
            console.log(`✅ MockPyth verified`);
        } catch (error: any) {
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ MockPyth already verified`);
            } else {
                console.error(`❌ Failed to verify MockPyth: ${error.message || error}`);
            }
        }

        // Verify MockAavePool (if used)
        if (useMockAave) {
            try {
                const mockAavePool = await deployments.get('MockAavePool');
                await hre.run('verify:verify', {
                    address: mockAavePool.address,
                    constructorArguments: [],
                });
                console.log(`✅ MockAavePool verified`);
            } catch (error: any) {
                if (error.message && error.message.includes('Already Verified')) {
                    console.log(`✅ MockAavePool already verified`);
                } else {
                    console.error(`❌ Failed to verify MockAavePool: ${error.message || error}`);
                }
            }
        }

        // Verify SmartYieldVault
        try {
            const smartYieldVault = await deployments.get('SmartYieldVault');
            await hre.run('verify:verify', {
                address: smartYieldVault.address,
                constructorArguments: [
                    customSwapVMRouterAddress,
                    aavePoolAddress,
                    deployer
                ],
            });
            console.log(`✅ SmartYieldVault verified`);
        } catch (error: any) {
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ SmartYieldVault already verified`);
            } else {
                console.error(`❌ Failed to verify SmartYieldVault: ${error.message || error}`);
            }
        }

        console.log('\n✅ Verification complete!\n');
    } else {
        console.log('Skipping verification for local network\n');
    }

    console.log('🎉 All components deployed successfully!');
    console.log('\n💡 Next steps:');
    console.log('  1. Check balances: npx hardhat run scripts/check-balances.ts --network sepolia');
    console.log('  2. Ship liquidity: npx hardhat run scripts/ship-liquidity-vault.ts --network sepolia');
    console.log('  3. Execute swap: npx hardhat run scripts/execute-swap.ts --network sepolia');
};

export default func;
func.tags = ['DeployAll'];
func.dependencies = []; // We handle dependencies manually in the script

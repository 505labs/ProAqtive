// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Deployment script for MockAavePool
 * 
 * Usage:
 *   # Deploy to a network (using npx directly)
 *   npx hardhat deploy --tags MockAavePool --network sepolia
 * 
 *   # Or use yarn script (pass network name as argument, NOT --network)
 *   yarn deploy:mock-aave sepolia
 *   # NOT: yarn deploy:mock-aave --network sepolia (this will fail)
 * 
 * Configuration:
 *   MockAavePool has no constructor arguments, so no configuration needed.
 *   This is a simple mock that tracks token balances for testing SmartYieldVault.
 */

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('Deploying MockAavePool with account:', deployer);

    // Deploy MockAavePool (no constructor arguments)
    const mockAavePoolDeploy = await deploy('MockAavePool', {
        from: deployer,
        args: [], // MockAavePool has no constructor arguments
        log: true,
        waitConfirmations: 1,
    });

    console.log(`MockAavePool deployed at: ${mockAavePoolDeploy.address}`);

    console.log('\n=== MockAavePool Deployment Summary ===');
    console.log(`MockAavePool: ${mockAavePoolDeploy.address}`);
    console.log('====================================\n');

    // Verify contract on Etherscan if not on localhost/hardhat
    if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
        console.log('Waiting for block confirmations before verification...');
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

        console.log('Verifying MockAavePool on Etherscan...');

        try {
            await hre.run('verify:verify', {
                address: mockAavePoolDeploy.address,
                constructorArguments: [], // MockAavePool has no constructor arguments
            });
            console.log(`✅ MockAavePool verified on Etherscan`);
        } catch (error: any) {
            // Check if it's already verified
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ MockAavePool is already verified on Etherscan`);
            } else {
                console.error('❌ Failed to verify MockAavePool:', error.message || error);
                console.log('\nYou can verify manually with:');
                console.log(`npx hardhat verify --network ${hre.network.name} ${mockAavePoolDeploy.address}`);
            }
        }
    } else {
        console.log('Skipping verification for local network');
    }
};

export default func;
func.tags = ['MockAavePool'];
func.dependencies = []; // MockAavePool has no dependencies


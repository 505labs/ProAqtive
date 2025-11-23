// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Deployment script for MockPyth oracle
 * 
 * Usage:
 *   # Deploy and set initial price (uses hardcoded defaults below)
 *   npx hardhat deploy --tags MockPyth --network sepolia
 * 
 *   # Deploy without setting price
 *   SET_PRICE=false npx hardhat deploy --tags MockPyth --network sepolia
 * 
 *   # Override with environment variables
 *   PRICE_ID="MY_PRICE_ID" PRICE=300000000 EXPONENT=-8 \
 *     npx hardhat deploy --tags MockPyth --network sepolia
 * 
 * Configuration:
 *   Edit the constants below to change default values, or use environment variables to override.
 *   Set SET_PRICE=false to skip price setting entirely.
 */

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';

// ============================================================================
// CONFIGURATION: Edit these values to set default price parameters
// ============================================================================
const DEFAULT_PRICE_ID = "TEST_PRICE_ID";  // Price feed ID (string, will be hashed to bytes32) - 0xd33f74f371e873dc67bd175008598d1d5cfdb5fe838da4b830cf7ac4fd0f78ce
const DEFAULT_PRICE = 200000000;            // Price value (int64, e.g., 200000000 = 2e8)
const DEFAULT_EXPONENT = -8;                 // Price exponent (int32, e.g., -8)
const DEFAULT_CONFIDENCE = 1000000;          // Confidence value (uint64, e.g., 1e6 = 0.01%)
const SET_PRICE_BY_DEFAULT = true;          // Set to false to skip price setting

// ============================================================================

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('Deploying MockPyth oracle with account:', deployer);

    // Deploy MockPyth (use fully qualified name to avoid conflict with @pythnetwork MockPyth)
    const mockPythDeploy = await deploy('MockPyth', {
        from: deployer,
        contract: 'contracts/mocks/MockPyth.sol:MockPyth',
        args: [], // MockPyth has no constructor arguments
        log: true,
        waitConfirmations: 1,
    });

    console.log(`MockPyth deployed at: ${mockPythDeploy.address}`);

    // Determine if we should set price (check env var first, then default)
    const shouldSetPrice = process.env.SET_PRICE !== undefined
        ? process.env.SET_PRICE.toLowerCase() === 'true'
        : SET_PRICE_BY_DEFAULT;

    if (shouldSetPrice) {
        // Use environment variables if provided, otherwise use hardcoded defaults
        const priceIdRaw = process.env.PRICE_ID || DEFAULT_PRICE_ID;
        const priceRaw = process.env.PRICE ? Number(process.env.PRICE) : DEFAULT_PRICE;
        const exponentRaw = process.env.EXPONENT ? parseInt(process.env.EXPONENT) : DEFAULT_EXPONENT;
        const confidenceRaw = process.env.CONFIDENCE ? Number(process.env.CONFIDENCE) : DEFAULT_CONFIDENCE;

        console.log('\nSetting initial price...');

        const mockPyth = await ethers.getContractAt('contracts/mocks/MockPyth.sol:MockPyth', mockPythDeploy.address);

        // Handle priceId: if it's hex, use directly, otherwise hash the string
        const priceId = priceIdRaw.startsWith('0x') ? priceIdRaw : ethers.id(priceIdRaw);

        // Parse values - matching test pattern: price is int64, confidence is uint64, exponent is int32
        // Using Number for all values (ethers.js will handle conversion to int64/uint64/int32)
        const price = priceRaw;
        const confidence = confidenceRaw;
        const exponent = exponentRaw;

        const actualPrice = price * Math.pow(10, exponent);

        console.log(`  Price ID: ${priceId} (from: ${priceIdRaw})`);
        console.log(`  Price: ${price} (exponent: ${exponent})`);
        console.log(`  Actual Price: ${actualPrice}`);
        console.log(`  Confidence: ${confidence}`);

        try {
            const tx = await mockPyth.setPrice(priceId, price, confidence, exponent);
            const receipt = await tx.wait();
            console.log(`✅ Initial price set successfully`);
            console.log(`   Transaction hash: ${receipt.hash}`);
        } catch (error: any) {
            console.error('❌ Failed to set initial price:', error.message || error);
        }
    } else {
        console.log('\n⏭️  Skipping price setting (SET_PRICE=false or SET_PRICE_BY_DEFAULT=false)');
    }

    console.log('\n=== MockPyth Deployment Summary ===');
    console.log(`MockPyth: ${mockPythDeploy.address}`);
    if (shouldSetPrice) {
        const priceIdRaw = process.env.PRICE_ID || DEFAULT_PRICE_ID;
        const priceId = priceIdRaw.startsWith('0x') ? priceIdRaw : ethers.id(priceIdRaw);
        console.log(`Initial Price ID: ${priceId}`);
    }
    console.log('====================================\n');

    // Verify contract on Etherscan if not on localhost/hardhat
    if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
        console.log('Waiting for block confirmations before verification...');
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

        console.log('Verifying MockPyth on Etherscan...');

        try {
            await hre.run('verify:verify', {
                address: mockPythDeploy.address,
                constructorArguments: [], // MockPyth has no constructor arguments
            });
            console.log(`✅ MockPyth verified on Etherscan`);
        } catch (error: any) {
            // Check if it's already verified
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ MockPyth is already verified on Etherscan`);
            } else {
                console.error('❌ Failed to verify MockPyth:', error.message || error);
                console.log('\nYou can verify manually with:');
                console.log(`npx hardhat verify --network ${hre.network.name} ${mockPythDeploy.address}`);
            }
        }
    } else {
        console.log('Skipping verification for local network');
    }
};

export default func;
func.tags = ['MockPyth'];
func.dependencies = []; // MockPyth has no dependencies


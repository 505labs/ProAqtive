// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Deployment script for test ERC20 tokens
 * 
 * Usage:
 *   # Deploy and mint tokens (uses hardcoded defaults below)
 *   npx hardhat deploy --tags TestTokens --network sepolia
 * 
 *   # Deploy without minting
 *   MINT_TOKENS=false npx hardhat deploy --tags TestTokens --network sepolia
 * 
 *   # Override with environment variables
 *   TOKEN0_NAME="MyToken0" TOKEN0_SYMBOL="MT0" MINT_AMOUNT=5000 \
 *     RECIPIENT1=0x... RECIPIENT2=0x... npx hardhat deploy --tags TestTokens --network sepolia
 * 
 * Configuration:
 *   Edit the constants below to change default values, or use environment variables to override.
 *   Set MINT_TOKENS=false to skip minting entirely.
 */

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';

// ============================================================================
// CONFIGURATION: Edit these values to set default token parameters
// ============================================================================
const DEFAULT_TOKEN0_NAME = "Mock ETH";
const DEFAULT_TOKEN0_SYMBOL = "0_METH";
const DEFAULT_TOKEN1_NAME = "Mock USDC";
const DEFAULT_TOKEN1_SYMBOL = "0_MUSDC";
const DEFAULT_MINT_AMOUNT = "1000";  // Amount to mint to each recipient (in token units, e.g., "1000" = 1000 tokens)
const MINT_TOKENS_BY_DEFAULT = true;  // Set to false to skip minting


const DEFAULT_RECIPIENTS: string[] = [
    "0xabc4cbf716472c47a61c8c2c5076895600f3cf10",
    "0x33267fc8a4343331f8e0f03123217ac4f70148f9",
]


// ============================================================================

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('Deploying test tokens with account:', deployer);

    // Get configuration (env vars override defaults)
    const token0Name = process.env.TOKEN0_NAME || DEFAULT_TOKEN0_NAME;
    const token0Symbol = process.env.TOKEN0_SYMBOL || DEFAULT_TOKEN0_SYMBOL;
    const token1Name = process.env.TOKEN1_NAME || DEFAULT_TOKEN1_NAME;
    const token1Symbol = process.env.TOKEN1_SYMBOL || DEFAULT_TOKEN1_SYMBOL;
    const mintAmountStr = process.env.MINT_AMOUNT || DEFAULT_MINT_AMOUNT;

    // Deploy Token0
    // Note: We need to use a unique name for each token deployment
    const token0Deploy = await deploy('TokenMock0', {
        contract: '@1inch/solidity-utils/contracts/mocks/TokenMock.sol:TokenMock',
        from: deployer,
        args: [token0Name, token0Symbol],
        log: true,
        waitConfirmations: 1,
    });

    console.log(`Token0 (${token0Symbol}) deployed at: ${token0Deploy.address}`);

    // Deploy Token1
    const token1Deploy = await deploy('TokenMock1', {
        contract: '@1inch/solidity-utils/contracts/mocks/TokenMock.sol:TokenMock',
        from: deployer,
        args: [token1Name, token1Symbol],
        log: true,
        waitConfirmations: 1,
    });

    console.log(`Token1 (${token1Symbol}) deployed at: ${token1Deploy.address}`);

    // Determine if we should mint tokens
    const shouldMint = process.env.MINT_TOKENS !== undefined
        ? process.env.MINT_TOKENS.toLowerCase() === 'true'
        : MINT_TOKENS_BY_DEFAULT;

    if (shouldMint) {
        console.log('\nMinting tokens...');

        // Get recipients from env vars or use defaults
        let recipients: string[] = [];

        // Check for RECIPIENT1, RECIPIENT2, etc. env vars
        let i = 1;
        while (process.env[`RECIPIENT${i}`]) {
            recipients.push(process.env[`RECIPIENT${i}`]!);
            i++;
        }

        // If no recipients specified, use default (deployer only)
        if (recipients.length === 0) {
            recipients = DEFAULT_RECIPIENTS.length > 0 ? DEFAULT_RECIPIENTS : [deployer];
        }

        // Parse mint amount (assumes 18 decimals)
        const mintAmount = ethers.parseEther(mintAmountStr);

        // Get contract instances - TokenMock has a mint function
        const token0 = await ethers.getContractAt('@1inch/solidity-utils/contracts/mocks/TokenMock.sol:TokenMock', token0Deploy.address);
        const token1 = await ethers.getContractAt('@1inch/solidity-utils/contracts/mocks/TokenMock.sol:TokenMock', token1Deploy.address);

        console.log(`  Minting ${mintAmountStr} tokens to ${recipients.length} recipient(s)...`);

        for (const recipient of recipients) {
            try {
                // Mint Token0
                const tx0 = await token0.mint(recipient, mintAmount);
                await tx0.wait();
                console.log(`  ✅ Minted ${mintAmountStr} ${token0Symbol} to ${recipient}`);

                // Mint Token1
                const tx1 = await token1.mint(recipient, mintAmount);
                await tx1.wait();
                console.log(`  ✅ Minted ${mintAmountStr} ${token1Symbol} to ${recipient}`);
            } catch (error: any) {
                console.error(`  ❌ Failed to mint to ${recipient}:`, error.message || error);
            }
        }
    } else {
        console.log('\n⏭️  Skipping token minting (MINT_TOKENS=false or MINT_TOKENS_BY_DEFAULT=false)');
    }

    console.log('\n=== Test Tokens Deployment Summary ===');
    console.log(`Token0 (${token0Symbol}): ${token0Deploy.address}`);
    console.log(`Token1 (${token1Symbol}): ${token1Deploy.address}`);
    if (shouldMint) {
        const recipients = (() => {
            let recs: string[] = [];
            let i = 1;
            while (process.env[`RECIPIENT${i}`]) {
                recs.push(process.env[`RECIPIENT${i}`]!);
                i++;
            }
            return recs.length > 0 ? recs : (DEFAULT_RECIPIENTS.length > 0 ? DEFAULT_RECIPIENTS : [deployer]);
        })();
        console.log(`Minted ${mintAmountStr} tokens to ${recipients.length} recipient(s)`);
    }
    console.log('======================================\n');

    // Verify contracts on Etherscan if not on localhost/hardhat
    if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
        console.log('Waiting for block confirmations before verification...');
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

        console.log('Verifying test tokens on Etherscan...');

        try {
            await hre.run('verify:verify', {
                address: token0Deploy.address,
                constructorArguments: [token0Name, token0Symbol],
            });
            console.log(`✅ Token0 verified on Etherscan`);
        } catch (error: any) {
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ Token0 is already verified on Etherscan`);
            } else {
                console.error('❌ Failed to verify Token0:', error.message || error);
            }
        }

        try {
            await hre.run('verify:verify', {
                address: token1Deploy.address,
                constructorArguments: [token1Name, token1Symbol],
            });
            console.log(`✅ Token1 verified on Etherscan`);
        } catch (error: any) {
            if (error.message && error.message.includes('Already Verified')) {
                console.log(`✅ Token1 is already verified on Etherscan`);
            } else {
                console.error('❌ Failed to verify Token1:', error.message || error);
            }
        }
    } else {
        console.log('Skipping verification for local network');
    }
};

export default func;
func.tags = ['TestTokens'];
func.dependencies = []; // Test tokens have no dependencies


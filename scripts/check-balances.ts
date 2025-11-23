// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to check token balances and contract addresses
 * 
 * Usage:
 *   TOKEN0=0x... TOKEN1=0x... ADDRESS=0x... npx hardhat run scripts/check-balances.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedAddress, displayBalance } from "./utils/helpers";

async function main() {
    console.log("=== Checking Balances and Addresses ===\n");

    // Get signers
    const [signer] = await ethers.getSigners();
    const address = process.env.ADDRESS || await signer.getAddress();
    console.log(`Checking address: ${address}\n`);

    // Get deployed contract addresses
    console.log("Deployed Contract Addresses:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Core Aqua contracts
    try {
        const aqua = await getDeployedAddress("Aqua");
        console.log(`  Aqua: ${aqua}`);
    } catch (e) {
        console.log("  Aqua: Not deployed");
    }

    try {
        const aquaAMM = await getDeployedAddress("AquaAMM");
        console.log(`  AquaAMM: ${aquaAMM}`);
    } catch (e) {
        console.log("  AquaAMM: Not deployed");
    }

    try {
        const aquaSwapVMRouter = await getDeployedAddress("AquaSwapVMRouter");
        console.log(`  AquaSwapVMRouter: ${aquaSwapVMRouter}`);
    } catch (e) {
        console.log("  AquaSwapVMRouter: Not deployed");
    }

    // Custom SwapVM Router
    try {
        const customSwapVM = await getDeployedAddress("CustomSwapVMRouter");
        console.log(`  CustomSwapVMRouter: ${customSwapVM}`);
    } catch (e) {
        console.log("  CustomSwapVMRouter: Not deployed");
    }

    // AMM Contracts
    try {
        const proAquativeAMM = await getDeployedAddress("ProAquativeAMM");
        console.log(`  ProAquativeAMM: ${proAquativeAMM}`);
    } catch (e) {
        console.log("  ProAquativeAMM: Not deployed");
    }

    try {
        const fixedPriceAMM = await getDeployedAddress("FixedPriceAMM");
        console.log(`  FixedPriceAMM: ${fixedPriceAMM}`);
    } catch (e) {
        console.log("  FixedPriceAMM: Not deployed");
    }

    try {
        const simpleConstantProductAMM = await getDeployedAddress("SimpleConstantProductAMM");
        console.log(`  SimpleConstantProductAMM: ${simpleConstantProductAMM}`);
    } catch (e) {
        console.log("  SimpleConstantProductAMM: Not deployed");
    }

    // Oracle
    try {
        const mockPyth = await getDeployedAddress("MockPyth");
        console.log(`  MockPyth (Oracle): ${mockPyth}`);
    } catch (e) {
        console.log("  MockPyth (Oracle): Not deployed");
    }

    // Vault
    try {
        const smartYieldVault = await getDeployedAddress("SmartYieldVault");
        console.log(`  SmartYieldVault: ${smartYieldVault}`);
    } catch (e) {
        console.log("  SmartYieldVault: Not deployed");
    }

    // Aave Pool (Mock or Real)
    try {
        const mockAavePool = await getDeployedAddress("MockAavePool");
        console.log(`  MockAavePool: ${mockAavePool}`);
    } catch (e) {
        console.log("  MockAavePool: Not deployed");
    }

    // Test/Mock Contracts
    try {
        const mockTaker = await getDeployedAddress("MockTaker");
        console.log(`  MockTaker: ${mockTaker}`);
    } catch (e) {
        console.log("  MockTaker: Not deployed");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Check token balances if provided
    const token0Address = process.env.TOKEN0 || process.env.TOKEN0_ADDRESS;
    const token1Address = process.env.TOKEN1 || process.env.TOKEN1_ADDRESS;

    if (token0Address || token1Address) {
        console.log("\nToken Balances:");

        if (token0Address) {
            try {
                const token0 = await ethers.getContractAt("IERC20", token0Address);
                await displayBalance(token0, address, `Token0 (${token0Address})`);
            } catch (e) {
                console.log(`  Token0: Error reading balance`);
            }
        }

        if (token1Address) {
            try {
                const token1 = await ethers.getContractAt("IERC20", token1Address);
                await displayBalance(token1, address, `Token1 (${token1Address})`);
            } catch (e) {
                console.log(`  Token1: Error reading balance`);
            }
        }
    }

    // Check ETH balance
    const ethBalance = await ethers.provider.getBalance(address);
    console.log(`\nETH Balance: ${ethers.formatEther(ethBalance)} ETH`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


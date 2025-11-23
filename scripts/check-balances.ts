// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Script to check token balances and contract addresses
 * 
 * Usage:
 *   TOKEN0=0x... TOKEN1=0x... ADDRESS=0x... npx hardhat run scripts/check-balances.ts --network sepolia
 */

import { ethers } from "hardhat";
import { getDeployedAddress, displayBalance } from "./utils/helpers";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20";

async function main() {
    console.log("=== Checking Balances and Addresses ===\n");

    // Get signers
    const [signer] = await ethers.getSigners();
    const address = process.env.ADDRESS || await signer.getAddress();
    console.log(`Checking address: ${address}\n`);

    // Get deployed contract addresses
    console.log("Deployed Contract Addresses:");
    try {
        const aqua = await getDeployedAddress("Aqua");
        console.log(`  Aqua: ${aqua}`);
    } catch (e) {
        console.log("  Aqua: Not deployed");
    }

    try {
        const customSwapVM = await getDeployedAddress("CustomSwapVMRouter");
        console.log(`  CustomSwapVMRouter: ${customSwapVM}`);
    } catch (e) {
        console.log("  CustomSwapVMRouter: Not deployed");
    }

    try {
        const proAquativeAMM = await getDeployedAddress("ProAquativeAMM");
        console.log(`  ProAquativeAMM: ${proAquativeAMM || "Not deployed"}`);
    } catch (e) {
        console.log("  ProAquativeAMM: Not deployed");
    }

    try {
        const mockPyth = await getDeployedAddress("MockPyth");
        console.log(`  MockPyth: ${mockPyth || "Not deployed"}`);
    } catch (e) {
        console.log("  MockPyth: Not deployed");
    }

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


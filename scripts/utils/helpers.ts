// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { ethers } from "hardhat";
import { deployments } from "hardhat-deploy";
import { ether } from "@1inch/solidity-utils";

/**
 * Get deployed contract address from hardhat-deploy
 */
export async function getDeployedAddress(contractName: string, network?: string): Promise<string> {
    const networkName = network || (await ethers.provider.getNetwork()).name;
    const deployment = await deployments.get(contractName, { networkName });
    return deployment.address;
}

/**
 * Get deployed contract instance
 */
export async function getDeployedContract<T>(contractName: string, network?: string): Promise<T> {
    const address = await getDeployedAddress(contractName, network);
    return (await ethers.getContractAt(contractName, address)) as T;
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: bigint, decimals: number = 18): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    return `${whole}.${fraction.toString().padStart(decimals, '0')}`;
}

/**
 * Parse token amount from string
 */
export function parseTokenAmount(amount: string, decimals: number = 18): bigint {
    return ether(amount);
}

/**
 * Wait for transaction and log details
 */
export async function waitForTx(tx: any, description: string) {
    console.log(`\n⏳ ${description}...`);
    console.log(`   Transaction hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`✅ ${description} completed!`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    return receipt;
}

/**
 * Display token balance
 */
export async function displayBalance(
    token: any,
    address: string,
    label: string,
    decimals: number = 18
) {
    const balance = await token.balanceOf(address);
    console.log(`   ${label}: ${formatTokenAmount(balance, decimals)}`);
}


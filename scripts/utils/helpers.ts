// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { ethers } from "hardhat";
import { ether } from "@1inch/solidity-utils";
import "hardhat-deploy";
import { loadConfig, Config } from "../../config/loadConfig";

/**
 * Get deployed contract address from hardhat-deploy
 */
export async function getDeployedAddress(contractName: string, network?: string): Promise<string> {
    const hre = await import("hardhat");
    const deployments = (hre as any).deployments;

    if (!deployments) {
        console.log(`   ⚠️  deployments not available in getDeployedAddress`);
        return "";
    }

    try {
        // Get current network if not provided
        const currentNetwork = network || (await ethers.provider.getNetwork()).name;
        const deployment = await deployments.get(contractName);
        return deployment.address;
    } catch (error: any) {
        // Contract not deployed yet
        console.log(`   ⚠️  Could not find deployment for ${contractName}: ${error.message || error}`);
        return "";
    }
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
    return BigInt(ethers.parseUnits(amount, decimals));
}

/**
 * Wait for all pending transactions for an address to be mined
 * This helps avoid "replacement transaction underpriced" errors
 */
export async function waitForPendingTransactions(address: string, provider: any) {
    try {
        // Get the current nonce
        const currentNonce = await provider.getTransactionCount(address, "pending");
        const latestNonce = await provider.getTransactionCount(address, "latest");

        // If there are pending transactions (nonce difference), wait a bit
        if (currentNonce > latestNonce) {
            // Wait for pending transactions to be mined
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (error) {
        // If checking nonce fails, just wait a bit anyway
        await new Promise(resolve => setTimeout(resolve, 300));
    }
}

/**
 * Wait for transaction and log details
 */
export async function waitForTx(tx: any, description: string) {
    console.log(`\n⏳ ${description}...`);
    console.log(`   Transaction hash: ${tx.hash}`);

    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    console.log(`✅ ${description} completed!`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    // Small delay to ensure transaction is fully processed and nonce is updated
    await new Promise(resolve => setTimeout(resolve, 300));

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

/**
 * Get default token addresses from config
 */
export function getDefaultTokens(): { USDC: string; DAI: string } {
    const config = loadConfig();
    const defaultUSDC = config.USDC!; // Mock ETH
    const defaultDAI = config.DAI!; // Mock USDC

    return {
        USDC: defaultUSDC,
        DAI: defaultDAI
    };
}

/**
 * Get order configuration from config with defaults
 * Returns values ready to use (converted to proper types)
 */
export function getOrderConfig(): {
    pythOracle?: string;
    priceId: string;
    k: bigint;
    maxStaleness: bigint;
    isTokenInBase: boolean;
    baseDecimals: number;
    quoteDecimals: number;
} {
    const config = loadConfig();

    const priceIdRaw = process.env.PRICE_ID || config.PRICE_ID || "TEST_PRICE_ID";
    const priceId = priceIdRaw.startsWith('0x') ? priceIdRaw : ethers.id(priceIdRaw);

    return {
        pythOracle: process.env.PYTH_ORACLE || config.PYTH_ORACLE,
        priceId: priceId,
        k: config.K ? BigInt(config.K) : 400000000000000000n,
        maxStaleness: config.MAX_STALENESS ? BigInt(config.MAX_STALENESS) : 3600n,
        isTokenInBase: config.IS_TOKEN_IN_BASE !== undefined ? config.IS_TOKEN_IN_BASE : true,
        baseDecimals: config.BASE_DECIMALS || 18,
        quoteDecimals: config.QUOTE_DECIMALS || 18,
    };
}

/**
 * Get price ID as bytes32 (hashed if it's a string)
 */
export function getPriceId(priceIdRaw: string): string {
    return priceIdRaw.startsWith('0x') ? priceIdRaw : ethers.id(priceIdRaw);
}

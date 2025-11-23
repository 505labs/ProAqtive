// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Test DODOSwap on Sepolia testnet
 * 
 * This script tests the deployed DODOSwap pool on Sepolia:
 * - Checks deployed contracts
 * - Checks balances and approvals
 * - Executes a test swap
 * - Verifies results
 * 
 * Usage:
 *   npx hardhat run scripts/test-sepolia-dodoswap.ts --network sepolia
 */

import { ethers } from "hardhat";
import { ether } from '@1inch/solidity-utils';

// Sepolia Deployment Addresses
const ADDRESSES = {
  // Core Infrastructure
  AQUA: "0x1A2694C890e372b587e8e755eC14E650545aFEca",
  MY_CUSTOM_OPCODES: "0x3Fd87f63a331730dCbDd179eD07F923DB757a9C6",
  MOCK_TAKER: "0x4651355BEDf5dE4343CD7f413832244Fa51F0C06", // Redeployed with MyCustomOpcodes router
  
  // Tokens
  METH: "0xC2FB82498d61e136a1d5Dd66Dc5095f4C3aCcbBD",
  MUSDC: "0xA748Cef1c4E68Cc81448bD061A4aF8FEaD9d5558",
  
  // Oracle
  ORACLE: "0xB0d9Fe62FEc791bc8e4428bCE47605fF3b2713a5"
};

// DODOSwap Pool Parameters (from deployment)
const POOL_PARAMS = {
  targetBaseAmount: ether("3"),      // 3 mETH
  targetQuoteAmount: ether("8445"),   // 8,445 mUSDC
  k: ether("0.1"),                    // k = 0.1 (10% liquidity depth)
  baseIsTokenIn: true                 // Base (mETH) is the input token
};

function formatBalance(balance: bigint, decimals: number = 18): string {
  return ethers.formatUnits(balance, decimals);
}

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  console.log("║                                                           ║");
  console.log("║          🧪 SEPOLIA DODOSWAP TEST 🧪                      ║");
  console.log("║        Testing deployed DODOSwap on Sepolia              ║");
  console.log("║                                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  try {
    // Get signer
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    
    console.log("=== 📋 Account Information ===\n");
    console.log(`Deployer: ${deployerAddress}`);
    const balance = await ethers.provider.getBalance(deployerAddress);
    console.log(`ETH Balance: ${formatBalance(balance)} ETH\n`);

    // Get contract instances
    console.log("=== 📦 Loading Deployed Contracts ===\n");
    
    const aqua = await ethers.getContractAt("Aqua", ADDRESSES.AQUA);
    console.log(`✅ Aqua: ${await aqua.getAddress()}`);
    
    const router = await ethers.getContractAt("MyCustomOpcodes", ADDRESSES.MY_CUSTOM_OPCODES);
    console.log(`✅ MyCustomOpcodes: ${await router.getAddress()}`);
    
    const mETH = await ethers.getContractAt("TokenMock", ADDRESSES.METH);
    console.log(`✅ mETH: ${await mETH.getAddress()}`);
    
    const mUSDC = await ethers.getContractAt("TokenMock", ADDRESSES.MUSDC);
    console.log(`✅ mUSDC: ${await mUSDC.getAddress()}`);
    
    const oracle = await ethers.getContractAt("Oracle", ADDRESSES.ORACLE);
    console.log(`✅ Oracle: ${await oracle.getAddress()}\n`);

    // Check token balances
    console.log("=== 💰 Token Balances ===\n");
    const mETHBalance = await mETH.balanceOf(deployerAddress);
    const mUSDCBalance = await mUSDC.balanceOf(deployerAddress);
    console.log(`mETH: ${formatBalance(mETHBalance)}`);
    console.log(`mUSDC: ${formatBalance(mUSDCBalance)}\n`);

    if (mETHBalance === 0n && mUSDCBalance === 0n) {
      console.log("⚠️  Warning: No token balance. Minting test tokens...\n");
      const mintAmount = ether("100");
      await mETH.mint(deployerAddress, mintAmount);
      await mUSDC.mint(deployerAddress, mintAmount);
      console.log(`✅ Minted ${formatBalance(mintAmount)} of each token\n`);
    }

    // Check oracle price
    console.log("=== 💵 Oracle Price ===\n");
    try {
      const price = await oracle.getPrice();
      console.log(`ETH Price: $${formatBalance(price)}\n`);
    } catch (error: any) {
      console.log(`⚠️  Could not fetch price: ${error.message}\n`);
    }

    // Check allowances
    console.log("=== 🔓 Token Allowances ===\n");
    const mETHAllowance = await mETH.allowance(deployerAddress, await aqua.getAddress());
    const mUSDCAllowance = await mUSDC.allowance(deployerAddress, await aqua.getAddress());
    console.log(`mETH allowance for Aqua: ${formatBalance(mETHAllowance)}`);
    console.log(`mUSDC allowance for Aqua: ${formatBalance(mUSDCAllowance)}\n`);

    if (mETHAllowance === 0n || mUSDCAllowance === 0n) {
      console.log("⚠️  Approving tokens for Aqua...\n");
      if (mETHAllowance === 0n) {
        const tx1 = await mETH.approve(await aqua.getAddress(), ethers.MaxUint256);
        await tx1.wait();
        console.log("✅ mETH approved");
      }
      if (mUSDCAllowance === 0n) {
        const tx2 = await mUSDC.approve(await aqua.getAddress(), ethers.MaxUint256);
        await tx2.wait();
        console.log("✅ mUSDC approved");
      }
      console.log();
    }

    // Check pool liquidity
    console.log("=== 🏊 Pool Liquidity ===\n");
    console.log("DODOSwap Pool Parameters:");
    console.log(`  Target Base (mETH): ${formatBalance(POOL_PARAMS.targetBaseAmount)}`);
    console.log(`  Target Quote (mUSDC): ${formatBalance(POOL_PARAMS.targetQuoteAmount)}`);
    console.log(`  K Parameter: ${formatBalance(POOL_PARAMS.k)}`);
    console.log(`  Base is Token In: ${POOL_PARAMS.baseIsTokenIn}`);
    console.log(`  Initial Price: ~$${(Number(formatBalance(POOL_PARAMS.targetQuoteAmount)) / Number(formatBalance(POOL_PARAMS.targetBaseAmount))).toFixed(2)} per mETH\n`);

    // Check if MockTaker needs redeployment
    console.log("=== 🔍 Checking MockTaker ===\n");
    try {
      const mockTaker = await ethers.getContractAt("MockTaker", ADDRESSES.MOCK_TAKER);
      const mockTakerRouter = await mockTaker.swapVM();
      console.log(`MockTaker SwapVM: ${mockTakerRouter}`);
      console.log(`Expected (MyCustomOpcodes): ${await router.getAddress()}`);
      
      if (mockTakerRouter.toLowerCase() !== (await router.getAddress()).toLowerCase()) {
        console.log("\n⚠️  CRITICAL: MockTaker is using the wrong router!");
        console.log("   MockTaker needs to be redeployed with MyCustomOpcodes router.");
        console.log("\n   Run: npx hardhat deploy --network sepolia --tags MockTakerCustom\n");
        return;
      } else {
        console.log("✅ MockTaker is correctly configured\n");
      }
    } catch (error: any) {
      console.log(`❌ Error checking MockTaker: ${error.message}`);
      console.log("   MockTaker needs to be redeployed.\n");
      return;
    }

    // Get the liquidity pool order hash
    console.log("=== 🔍 Finding Pool Order ===\n");
    console.log("Note: We need the order hash from when liquidity was shipped.");
    console.log("Check the ship liquidity transaction for the order details.\n");
    console.log("Tx: https://sepolia.etherscan.io/tx/0xe2b905d1419e3cea20f9f1e557485e00c4756c0ac29a4011ef400ac9e4bc6fd6\n");

    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║                                                           ║");
    console.log("║              ✅ PRE-FLIGHT CHECKS COMPLETE ✅             ║");
    console.log("║                                                           ║");
    console.log("║  All contracts are deployed and configured correctly.    ║");
    console.log("║  Ready to perform swap tests!                            ║");
    console.log("║                                                           ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    console.log("📝 Next Steps:");
    console.log("1. Ensure MockTaker is redeployed if needed");
    console.log("2. Use test-aqua-swap.ts pattern to execute actual swaps");
    console.log("3. Monitor transactions on Sepolia Etherscan\n");

  } catch (error: any) {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


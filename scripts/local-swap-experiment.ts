// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

/**
 * Complete local swap experiment
 * Deploys all contracts, ships liquidity, and executes a swap
 * 
 * Usage:
 *   npx hardhat run scripts/local-swap-experiment.ts --network localhost
 *   (or just run without --network to use in-memory hardhat network)
 */

import { ethers } from "hardhat";
import { expect, ether } from '@1inch/solidity-utils';
import { Aqua } from "../typechain-types/@1inch/aqua/src/Aqua";
import { MyCustomOpcodes } from "../typechain-types/contracts/MyCustomOpcodes";
import { CustomSwapVMRouter } from "../typechain-types/contracts/CustomSwapVMRouter";
import { MockTaker } from "../typechain-types/contracts/MockTaker";
import { TokenMock } from "../typechain-types/@1inch/solidity-utils/contracts/mocks/TokenMock";
import { TakerTraitsLib, MakerTraitsLib } from "../test/utils/SwapVMHelpers";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";

const DODO_SWAP_OPCODE = 0x1D;

function formatBalance(balance: bigint, decimals: number = 18): string {
  return ethers.formatUnits(balance, decimals);
}

async function deployContracts() {
  console.log("=== 🚀 Deploying Contracts Locally ===\n");
  
  const [deployer, maker, taker] = await ethers.getSigners();
  
  console.log("Accounts:");
  console.log(`  Deployer: ${await deployer.getAddress()}`);
  console.log(`  Maker: ${await maker.getAddress()}`);
  console.log(`  Taker: ${await taker.getAddress()}\n`);
  
  // Deploy Aqua
  console.log("📦 Deploying Aqua...");
  const AquaFactory = await ethers.getContractFactory("Aqua");
  const aqua = await AquaFactory.deploy() as Aqua;
  await aqua.waitForDeployment();
  console.log(`   ✅ Aqua deployed at: ${await aqua.getAddress()}\n`);
  
  // Deploy tokens
  console.log("📦 Deploying tokens...");
  const TokenFactory = await ethers.getContractFactory("TokenMock");
  const mETH = await TokenFactory.deploy("Mock ETH", "mETH") as TokenMock;
  const mUSDC = await TokenFactory.deploy("Mock USDC", "mUSDC") as TokenMock;
  await mETH.waitForDeployment();
  await mUSDC.waitForDeployment();
  console.log(`   ✅ mETH deployed at: ${await mETH.getAddress()}`);
  console.log(`   ✅ mUSDC deployed at: ${await mUSDC.getAddress()}\n`);
  
  // Deploy Mock Oracle
  console.log("📦 Deploying Mock Oracle...");
  const MockOracleFactory = await ethers.getContractFactory("MockPriceOracle");
  const ethPrice = ether("2815"); // $2815 per ETH
  const mockOracle = await MockOracleFactory.deploy(ethPrice);
  await mockOracle.waitForDeployment();
  console.log(`   ✅ Mock Oracle deployed at: ${await mockOracle.getAddress()}`);
  console.log(`   💰 ETH Price: $${formatBalance(ethPrice)}\n`);
  
  // Deploy MyCustomOpcodes
  console.log("📦 Deploying MyCustomOpcodes (with DODOSwap)...");
  const CustomOpcodesFactory = await ethers.getContractFactory("MyCustomOpcodes");
  const customOpcodes = await CustomOpcodesFactory.deploy(await aqua.getAddress()) as MyCustomOpcodes;
  await customOpcodes.waitForDeployment();
  console.log(`   ✅ MyCustomOpcodes deployed at: ${await customOpcodes.getAddress()}\n`);
  
  // Deploy CustomSwapVMRouter
  console.log("📦 Deploying CustomSwapVMRouter...");
  const RouterFactory = await ethers.getContractFactory("CustomSwapVMRouter");
  const router = await RouterFactory.deploy(
    await aqua.getAddress(),
    "CustomSwapVM",
    "1.0"
  ) as CustomSwapVMRouter;
  await router.waitForDeployment();
  console.log(`   ✅ CustomSwapVMRouter deployed at: ${await router.getAddress()}\n`);
  
  // Deploy MockTaker
  console.log("📦 Deploying MockTaker...");
  const MockTakerFactory = await ethers.getContractFactory("MockTaker");
  const mockTaker = await MockTakerFactory.deploy(
    await aqua.getAddress(),
    await router.getAddress(),
    await deployer.getAddress()
  ) as MockTaker;
  await mockTaker.waitForDeployment();
  console.log(`   ✅ MockTaker deployed at: ${await mockTaker.getAddress()}\n`);
  
  return {
    accounts: { deployer, maker, taker },
    contracts: { aqua, router, customOpcodes, mockTaker, mockOracle },
    tokens: { mETH, mUSDC }
  };
}

async function mintAndApprove(
  tokens: { mETH: TokenMock; mUSDC: TokenMock },
  accounts: any,
  contracts: any
) {
  console.log("=== 💰 Minting and Approving Tokens ===\n");
  
  const { maker, taker } = accounts;
  const { aqua, mockTaker } = contracts;
  const { mETH, mUSDC } = tokens;
  
  // Mint tokens to maker
  const makerAmount = ether("10000");
  console.log(`Minting ${formatBalance(makerAmount)} tokens to maker...`);
  await mETH.mint(await maker.getAddress(), makerAmount);
  await mUSDC.mint(await maker.getAddress(), makerAmount);
  console.log(`   ✅ Minted ${formatBalance(makerAmount)} mETH to maker`);
  console.log(`   ✅ Minted ${formatBalance(makerAmount)} mUSDC to maker\n`);
  
  // Mint tokens to taker
  const takerAmount = ether("100");
  console.log(`Minting ${formatBalance(takerAmount)} tokens to taker...`);
  await mETH.mint(await taker.getAddress(), takerAmount);
  await mUSDC.mint(await taker.getAddress(), takerAmount);
  console.log(`   ✅ Minted ${formatBalance(takerAmount)} mETH to taker`);
  console.log(`   ✅ Minted ${formatBalance(takerAmount)} mUSDC to taker\n`);
  
  // Mint tokens to MockTaker
  await mETH.mint(await mockTaker.getAddress(), takerAmount);
  await mUSDC.mint(await mockTaker.getAddress(), takerAmount);
  console.log(`   ✅ Minted ${formatBalance(takerAmount)} mETH to MockTaker`);
  console.log(`   ✅ Minted ${formatBalance(takerAmount)} mUSDC to MockTaker\n`);
  
  // Approve tokens for Aqua
  console.log("Approving tokens for Aqua...");
  await mETH.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
  await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
  console.log(`   ✅ Maker approved mETH and mUSDC for Aqua\n`);
}

async function buildDODOOrder(
  maker: any,
  customOpcodes: MyCustomOpcodes,
  mockOracle: any,
  targetBaseAmount: bigint,
  targetQuoteAmount: bigint,
  k: bigint,
  baseIsTokenIn: boolean
) {
  // Encode DODOParams
  const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address oracle, uint256 k, uint256 targetBaseAmount, uint256 targetQuoteAmount, bool baseIsTokenIn)"],
    [[
      await mockOracle.getAddress(),
      k,
      targetBaseAmount,
      targetQuoteAmount,
      baseIsTokenIn
    ]]
  );

  // Build program using ProgramBuilder
  const programBuilder = new ProgramBuilder();
  programBuilder.addInstruction(DODO_SWAP_OPCODE, dodoParams);
  const program = programBuilder.build();

  // Use MakerTraitsLib to build order
  const order = MakerTraitsLib.build({
    maker: await maker.getAddress(),
    receiver: await maker.getAddress(),
    useAquaInsteadOfSignature: true,
    program: program
  });

  return order;
}

async function shipLiquidity(
  aqua: Aqua,
  router: CustomSwapVMRouter,
  customOpcodes: MyCustomOpcodes,
  maker: any,
  tokens: { mETH: TokenMock; mUSDC: TokenMock },
  mockOracle: any
) {
  console.log("=== 🚢 Shipping DODOSwap Liquidity ===\n");
  
  const { mETH, mUSDC } = tokens;
  
  // DODOSwap parameters
  const targetBaseAmount = ether("100");    // 100 mETH
  const targetQuoteAmount = ether("281500"); // 281,500 mUSDC (~$2815 * 100)
  const k = ether("0.1");                   // k = 0.1 (10% liquidity depth)
  const baseIsTokenIn = true;               // Base (mETH) is the input token
  
  console.log("Pool Parameters:");
  console.log(`  Target Base Amount: ${formatBalance(targetBaseAmount)} mETH`);
  console.log(`  Target Quote Amount: ${formatBalance(targetQuoteAmount)} mUSDC`);
  console.log(`  K Parameter: ${formatBalance(k)}`);
  console.log(`  Base is Token In: ${baseIsTokenIn}`);
  console.log(`  Initial Price: ~$${(Number(formatBalance(targetQuoteAmount)) / Number(formatBalance(targetBaseAmount))).toFixed(2)} per mETH\n`);
  
  // Build order
  const order = await buildDODOOrder(
    maker,
    customOpcodes,
    mockOracle,
    targetBaseAmount,
    targetQuoteAmount,
    k,
    baseIsTokenIn
  );
  
  // Encode order
  const encodedOrder = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address maker, uint256 traits, bytes data)"],
    [order]
  );
  
  // Ship liquidity
  console.log("Shipping liquidity to Aqua...");
  const shipTx = await aqua.connect(maker).ship(
    await router.getAddress(),
    encodedOrder,
    [await mETH.getAddress(), await mUSDC.getAddress()],
    [targetBaseAmount, targetQuoteAmount]
  );
  await shipTx.wait();
  
  console.log(`   ✅ Liquidity shipped successfully!\n`);
  
  return { order, targetBaseAmount, targetQuoteAmount, k };
}

async function executeSwap(
  router: CustomSwapVMRouter,
  mockTaker: MockTaker,
  tokens: { mETH: TokenMock; mUSDC: TokenMock },
  order: any,
  accounts: any
) {
  console.log("=== 🔄 Executing Swap ===\n");
  
  const { mETH, mUSDC } = tokens;
  const { taker } = accounts;
  
  const swapAmount = ether("1"); // Swap 1 mETH for mUSDC
  
  console.log(`Swap Configuration:`);
  console.log(`  Swapping: ${formatBalance(swapAmount)} mETH`);
  console.log(`  For: mUSDC`);
  console.log(`  Using: MockTaker\n`);
  
  // Check balances before
  const takerMETHBefore = await mETH.balanceOf(await mockTaker.getAddress());
  const takerUSDCBefore = await mUSDC.balanceOf(await mockTaker.getAddress());
  
  console.log("MockTaker Balances Before:");
  console.log(`  mETH: ${formatBalance(takerMETHBefore)}`);
  console.log(`  mUSDC: ${formatBalance(takerUSDCBefore)}\n`);
  
  // Build taker traits
  const minAmountOut = ether("2000"); // Expect at least 2000 mUSDC (with slippage)
  const takerData = TakerTraitsLib.build({
    taker: await mockTaker.getAddress(),
    isExactIn: true,
    threshold: minAmountOut,
    hasPreTransferInCallback: true,
    preTransferInCallbackData: "0x"
  });
  
  console.log(`Executing swap with ${formatBalance(swapAmount)} mETH...`);
  console.log(`Minimum expected output: ${formatBalance(minAmountOut)} mUSDC\n`);
  
  // Execute swap
  const swapTx = await mockTaker.swap(
    order,
    await mETH.getAddress(),
    await mUSDC.getAddress(),
    swapAmount,
    takerData
  );
  
  const receipt = await swapTx.wait();
  console.log(`   ✅ Swap executed successfully!`);
  console.log(`   Gas used: ${receipt?.gasUsed.toString()}\n`);
  
  // Check balances after
  const takerMETHAfter = await mETH.balanceOf(await mockTaker.getAddress());
  const takerUSDCAfter = await mUSDC.balanceOf(await mockTaker.getAddress());
  
  console.log("MockTaker Balances After:");
  console.log(`  mETH: ${formatBalance(takerMETHAfter)}`);
  console.log(`  mUSDC: ${formatBalance(takerUSDCAfter)}\n`);
  
  const mETHChange = takerMETHAfter - takerMETHBefore;
  const mUSDCChange = takerUSDCAfter - takerUSDCBefore;
  
  console.log("Balance Changes:");
  console.log(`  mETH: ${mETHChange >= 0n ? '+' : ''}${formatBalance(mETHChange)}`);
  console.log(`  mUSDC: ${mUSDCChange >= 0n ? '+' : ''}${formatBalance(mUSDCChange)}\n`);
  
  // Calculate effective price
  const effectivePrice = Number(formatBalance(mUSDCChange)) / Number(formatBalance(-mETHChange));
  console.log(`📊 Swap Results:`);
  console.log(`   Sold: ${formatBalance(-mETHChange)} mETH`);
  console.log(`   Received: ${formatBalance(mUSDCChange)} mUSDC`);
  console.log(`   Effective Price: $${effectivePrice.toFixed(2)} per mETH`);
  console.log(`   Expected Price: ~$2815 per mETH (from oracle)\n`);
  
  return { mETHChange, mUSDCChange, effectivePrice };
}

async function main() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║                                                           ║");
  console.log("║           🧪 LOCAL SWAP EXPERIMENT 🧪                     ║");
  console.log("║         DODOSwap on Local Hardhat Network                ║");
  console.log("║                                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("\n");
  
  try {
    // Step 1: Deploy all contracts
    const { accounts, contracts, tokens } = await deployContracts();
    
    // Step 2: Mint and approve tokens
    await mintAndApprove(tokens, accounts, contracts);
    
    // Step 3: Ship DODOSwap liquidity
    const { order } = await shipLiquidity(
      contracts.aqua,
      contracts.router,
      contracts.customOpcodes,
      accounts.maker,
      tokens,
      contracts.mockOracle
    );
    
    // Step 4: Execute swap
    await executeSwap(
      contracts.router,
      contracts.mockTaker,
      tokens,
      order,
      accounts
    );
    
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║                                                           ║");
    console.log("║              ✅ EXPERIMENT SUCCESSFUL! ✅                 ║");
    console.log("║                                                           ║");
    console.log("║  All contracts deployed, liquidity shipped, and swap     ║");
    console.log("║  executed successfully on local Hardhat network!         ║");
    console.log("║                                                           ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log("\n");
    
  } catch (error: any) {
    console.error("\n❌ Experiment failed:");
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


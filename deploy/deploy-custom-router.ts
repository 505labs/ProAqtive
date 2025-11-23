// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log('Deploying CustomSwapVMRouter with account:', deployer);

  // Get Aqua address (must be deployed first)
  let aquaAddress: string;
  try {
    const aqua = await get('Aqua');
    aquaAddress = aqua.address;
    console.log(`Using existing Aqua at: ${aquaAddress}`);
  } catch (error) {
    throw new Error('Aqua not deployed. Please deploy Aqua first with: npx hardhat deploy --tags Aqua --network <network>');
  }

  // Deploy CustomSwapVMRouter (full router with SwapVM + custom opcodes)
  const customRouterDeploy = await deploy('CustomSwapVMRouter', {
    from: deployer,
    contract: 'CustomSwapVMRouter',
    args: [aquaAddress, "Custom SwapVM Router", "1.0"],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`CustomSwapVMRouter deployed at: ${customRouterDeploy.address}`);

  console.log('\n=== CustomSwapVMRouter Deployment Summary ===');
  console.log(`Aqua: ${aquaAddress}`);
  console.log(`CustomSwapVMRouter: ${customRouterDeploy.address}`);
  console.log('=============================================\n');

  console.log('📝 Custom Opcodes Registered:');
  console.log('  - 0x00-0x1B: Standard Aqua opcodes (28 total)');
  console.log('  - 0x1C (28): FixedPriceSwap._fixedPriceSwapXD');
  console.log('  - 0x1D (29): DODOSwap._dodoSwapXD');
  console.log('');

  // Verify contracts if not on localhost
  if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
    console.log('Waiting for block confirmations...');
    await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

    console.log('Verifying CustomSwapVMRouter on Etherscan...');

    try {
      await hre.run('verify:verify', {
        address: customRouterDeploy.address,
        constructorArguments: [aquaAddress, "Custom SwapVM Router", "1.0"],
      });
      console.log(`✅ CustomSwapVMRouter verified`);
    } catch (error: any) {
      if (error.message && error.message.includes('Already Verified')) {
        console.log(`✅ CustomSwapVMRouter is already verified on Etherscan`);
      } else {
        console.error('❌ Failed to verify CustomSwapVMRouter:', error.message || error);
        console.log('\nYou can verify manually with:');
        console.log(`npx hardhat verify --network ${hre.network.name} ${customRouterDeploy.address} ${aquaAddress} "Custom SwapVM Router" "1.0"`);
      }
    }
  }

  console.log('\n💡 Next Steps:');
  console.log(`1. Use CustomSwapVMRouter address for swaps: ${customRouterDeploy.address}`);
  console.log(`2. Ship liquidity using this router`);
  console.log(`3. DODOSwap opcode is 0x1D (29), FixedPriceSwap is 0x1C (28)`);
};

export default func;
func.tags = ['CustomRouter', 'MyCustomOpcodes', 'DODOSwap'];
func.dependencies = ['Aqua']; // Requires Aqua to be deployed first


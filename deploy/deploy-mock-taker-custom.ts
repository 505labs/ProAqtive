// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';

/**
 * Deploys MockTaker with MyCustomOpcodes router for DODOSwap testing
 * 
 * This is needed because the standard MockTaker deployment uses AquaSwapVMRouter,
 * but we need to use MyCustomOpcodes router which has the DODOSwap instruction.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log('\n=== Deploying MockTaker with Custom Router ===');
  console.log('Deploying with account:', deployer);

  // Get existing deployments
  const aqua = await get('Aqua');
  const customRouter = await get('CustomSwapVMRouter');

  console.log(`Using Aqua: ${aqua.address}`);
  console.log(`Using CustomSwapVMRouter: ${customRouter.address}`);

  // Deploy MockTaker with custom router
  const mockTakerDeploy = await deploy('MockTaker', {
    from: deployer,
    args: [
      aqua.address,
      customRouter.address,  // Use CustomSwapVMRouter instead of AquaSwapVMRouter
      deployer
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`✅ MockTaker deployed at: ${mockTakerDeploy.address}`);
  console.log(`   - Aqua: ${aqua.address}`);
  console.log(`   - SwapVM Router: ${customRouter.address}`);
  console.log(`   - Owner: ${deployer}`);

  // Verify contract if not on localhost
  if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
    console.log('\nWaiting for block confirmations before verification...');
    await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

    console.log('Verifying MockTaker...');
    try {
      await hre.run('verify:verify', {
        address: mockTakerDeploy.address,
        constructorArguments: [
          aqua.address,
          customRouter.address,
          deployer
        ],
      });
      console.log(`✅ MockTaker verified on Etherscan`);
    } catch (error: any) {
      if (error.message.includes('Already Verified')) {
        console.log('✅ MockTaker already verified');
      } else {
        console.error('❌ Failed to verify MockTaker:', error.message);
      }
    }
  }

  console.log('\n=== Deployment Complete ===\n');
};

export default func;
func.tags = ['MockTakerCustom'];
func.dependencies = ['Aqua', 'CustomRouter'];


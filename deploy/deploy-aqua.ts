// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log('Deploying contracts with account:', deployer);

  // Deploy Aqua
  const aquaDeploy = await deploy('Aqua', {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`Aqua deployed at: ${aquaDeploy.address}`);

  // Deploy AquaAMM
  const aquaAMMDeploy = await deploy('AquaAMM', {
    from: deployer,
    args: [aquaDeploy.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`AquaAMM deployed at: ${aquaAMMDeploy.address}`);

  // Deploy AquaSwapVMRouter
  const aquaSwapVMRouterDeploy = await deploy('AquaSwapVMRouter', {
    from: deployer,
    args: [
      aquaDeploy.address,
      'AquaSwapVM',
      '1.0.0'
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`AquaSwapVMRouter deployed at: ${aquaSwapVMRouterDeploy.address}`);

  // Deploy MockTaker for testing (optional, can be commented out for production)
  const mockTakerDeploy = await deploy('MockTaker', {
    from: deployer,
    args: [
      aquaDeploy.address,
      aquaSwapVMRouterDeploy.address,
      deployer
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`MockTaker deployed at: ${mockTakerDeploy.address}`);

  console.log('\n=== Deployment Summary ===');
  console.log(`Aqua: ${aquaDeploy.address}`);
  console.log(`AquaAMM: ${aquaAMMDeploy.address}`);
  console.log(`AquaSwapVMRouter: ${aquaSwapVMRouterDeploy.address}`);
  console.log(`MockTaker: ${mockTakerDeploy.address}`);
  console.log('==========================\n');

  // Verify contracts if not on localhost
  if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
    console.log('Waiting for block confirmations...');
    await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

    console.log('Verifying contracts...');

    try {
      await hre.run('verify:verify', {
        address: aquaDeploy.address,
        constructorArguments: [],
      });
      console.log(`Aqua verified`);
    } catch (error) {
      console.error('Failed to verify Aqua:', error);
    }

    try {
      await hre.run('verify:verify', {
        address: aquaAMMDeploy.address,
        constructorArguments: [aquaDeploy.address],
      });
      console.log(`AquaAMM verified`);
    } catch (error) {
      console.error('Failed to verify AquaAMM:', error);
    }

    try {
      await hre.run('verify:verify', {
        address: aquaSwapVMRouterDeploy.address,
        constructorArguments: [
          aquaDeploy.address,
          'AquaSwapVM',
          '1.0.0'
        ],
      });
      console.log(`AquaSwapVMRouter verified`);
    } catch (error) {
      console.error('Failed to verify AquaSwapVMRouter:', error);
    }

    try {
      await hre.run('verify:verify', {
        address: mockTakerDeploy.address,
        constructorArguments: [
          aquaDeploy.address,
          aquaSwapVMRouterDeploy.address,
          deployer
        ],
      });
      console.log(`MockTaker verified`);
    } catch (error) {
      console.error('Failed to verify MockTaker:', error);
    }
  }
};

export default func;
func.tags = ['Aqua', 'AquaAMM', 'AquaSwapVMRouter', 'MockTaker'];
func.dependencies = [];

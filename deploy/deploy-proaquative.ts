// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import 'hardhat-deploy';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('Deploying ProAquativeAMM contracts with account:', deployer);

    // First, we need Aqua deployed (either from deploy-aqua.ts or already deployed)
    // If Aqua is not deployed, we'll deploy it first
    let aquaAddress: string;

    const existingAqua = await deployments.getOrNull('Aqua');
    if (existingAqua) {
        aquaAddress = existingAqua.address;
        console.log(`Using existing Aqua at: ${aquaAddress}`);
    } else {
        console.log('Aqua not found, deploying...');
        const aquaDeploy = await deploy('Aqua', {
            from: deployer,
            args: [],
            log: true,
            waitConfirmations: 1,
        });
        aquaAddress = aquaDeploy.address;
        console.log(`Aqua deployed at: ${aquaAddress}`);
    }

    // Deploy CustomSwapVMRouter (uses MyCustomOpcodes with ProAquativeMM instruction)
    // Only deploy if it doesn't already exist
    let customSwapVMRouterAddress: string;
    const existingCustomSwapVMRouter = await deployments.getOrNull('CustomSwapVMRouter');
    if (existingCustomSwapVMRouter) {
        customSwapVMRouterAddress = existingCustomSwapVMRouter.address;
        console.log(`Using existing CustomSwapVMRouter at: ${customSwapVMRouterAddress}`);
    } else {
        console.log('CustomSwapVMRouter not found, deploying...');
        const customSwapVMRouterDeploy = await deploy('CustomSwapVMRouter', {
            from: deployer,
            args: [
                aquaAddress,
                'CustomSwapVM',
                '1.0.0'
            ],
            log: true,
            waitConfirmations: 1,
        });
        customSwapVMRouterAddress = customSwapVMRouterDeploy.address;
        console.log(`CustomSwapVMRouter deployed at: ${customSwapVMRouterAddress}`);
    }

    // Deploy ProAquativeAMM
    const proAquativeAMMDeploy = await deploy('ProAquativeAMM', {
        from: deployer,
        args: [aquaAddress],
        log: true,
        waitConfirmations: 1,
    });

    console.log(`ProAquativeAMM deployed at: ${proAquativeAMMDeploy.address}`);

    // // Deploy FixedPriceAMM (optional, for completeness)
    // const fixedPriceAMMDeploy = await deploy('FixedPriceAMM', {
    //     from: deployer,
    //     args: [aquaAddress],
    //     log: true,
    //     waitConfirmations: 1,
    // });

    // console.log(`FixedPriceAMM deployed at: ${fixedPriceAMMDeploy.address}`);

    // // Deploy SimpleConstantProductAMM (optional, for completeness)
    // const simpleConstantProductAMMDeploy = await deploy('SimpleConstantProductAMM', {
    //     from: deployer,
    //     args: [aquaAddress],
    //     log: true,
    //     waitConfirmations: 1,
    // });

    // console.log(`SimpleConstantProductAMM deployed at: ${simpleConstantProductAMMDeploy.address}`);

    console.log('\n=== ProAquativeAMM Deployment Summary ===');
    console.log(`Aqua: ${aquaAddress}`);
    console.log(`CustomSwapVMRouter: ${customSwapVMRouterAddress}`);
    console.log(`ProAquativeAMM: ${proAquativeAMMDeploy.address}`);
    // console.log(`FixedPriceAMM: ${fixedPriceAMMDeploy.address}`);
    // console.log(`SimpleConstantProductAMM: ${simpleConstantProductAMMDeploy.address}`);
    console.log('==========================================\n');

    // Verify contracts if not on localhost
    if (hre.network.name !== 'localhost' && hre.network.name !== 'hardhat') {
        console.log('Waiting for block confirmations...');
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds

        console.log('Verifying contracts...');

        try {
            await hre.run('verify:verify', {
                address: customSwapVMRouterAddress,
                constructorArguments: [
                    aquaAddress,
                    'CustomSwapVM',
                    '1.0.0'
                ],
            });
            console.log(`CustomSwapVMRouter verified`);
        } catch (error) {
            console.error('Failed to verify CustomSwapVMRouter:', error);
        }

        try {
            await hre.run('verify:verify', {
                address: proAquativeAMMDeploy.address,
                constructorArguments: [aquaAddress],
            });
            console.log(`ProAquativeAMM verified`);
        } catch (error) {
            console.error('Failed to verify ProAquativeAMM:', error);
        }

        // try {
        //     await hre.run('verify:verify', {
        //         address: fixedPriceAMMDeploy.address,
        //         constructorArguments: [aquaAddress],
        //     });
        //     console.log(`FixedPriceAMM verified`);
        // } catch (error) {
        //     console.error('Failed to verify FixedPriceAMM:', error);
        // }

        // try {
        //     await hre.run('verify:verify', {
        //         address: simpleConstantProductAMMDeploy.address,
        //         constructorArguments: [aquaAddress],
        //     });
        //     console.log(`SimpleConstantProductAMM verified`);
        // } catch (error) {
        //     console.error('Failed to verify SimpleConstantProductAMM:', error);
        // }
    }
};

export default func;
func.tags = ['ProAquativeAMM', 'CustomSwapVMRouter', 'FixedPriceAMM', 'SimpleConstantProductAMM'];
func.dependencies = []; // Can be empty or ['Aqua'] if you want to ensure Aqua is deployed first


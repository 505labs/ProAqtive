// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import "@nomicfoundation/hardhat-chai-matchers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer } from 'ethers';
import { expect, ether, constants } from '@1inch/solidity-utils';

// Import fixtures and helpers
import { deployFixture } from "./utils/fixtures";
import { TakerTraitsLib } from "./utils/SwapVMHelpers";

// Import generated types
import { Aqua } from '../typechain-types/@1inch/aqua/src/Aqua';
import { ProAquativeAMM } from '../typechain-types/contracts/ProAquativeAMM';
import { CustomSwapVMRouter } from '../typechain-types/contracts/CustomSwapVMRouter';
import { MockTaker } from '../typechain-types/contracts/MockTaker';
import { TokenMock } from '../typechain-types/@1inch/solidity-utils/contracts/mocks/TokenMock';
import { MockPyth } from '../typechain-types/contracts/mocks/MockPyth';
import { SmartYieldVault } from '../typechain-types/contracts/SmartYieldVault.sol/SmartYieldVault';
import { MockAavePool } from '../typechain-types/contracts/mocks/MockAavePool';

const { ethers } = require("hardhat");

interface SetupFixtureResult {
    accounts: {
        owner: Signer;
        maker: Signer;
        taker: Signer;
        feeReceiver: Signer;
    };
    tokens: {
        token0: TokenMock;
        token1: TokenMock;
    };
    contracts: {
        aqua: Aqua;
        proAquativeAMM: ProAquativeAMM;
        swapVM: CustomSwapVMRouter;
        mockTaker: MockTaker;
        mockPyth: MockPyth;
        smartYieldVault: SmartYieldVault;
        mockAavePool: MockAavePool;
    };
}

describe("SmartYieldVault", function () {
    async function setupFixture(): Promise<SetupFixtureResult> {
        const {
            accounts,
            tokens,
            contracts
        } = await deployFixture();

        // Deploy MockPyth
        const MockPyth = await ethers.getContractFactory("MockPyth");
        const mockPyth = await MockPyth.deploy() as MockPyth;

        // Deploy MockAavePool
        const MockAavePool = await ethers.getContractFactory("MockAavePool");
        const mockAavePool = await MockAavePool.deploy() as MockAavePool;

        // Deploy CustomSwapVMRouter
        const CustomSwapVMRouter = await ethers.getContractFactory("CustomSwapVMRouter");
        const customSwapVM = await CustomSwapVMRouter.deploy(
            await contracts.aqua.getAddress(),
            "CustomSwapVM",
            "1.0.0"
        ) as CustomSwapVMRouter;

        // Deploy ProAquativeAMM
        const ProAquativeAMM = await ethers.getContractFactory("ProAquativeAMM");
        const proAquativeAMM = await ProAquativeAMM.deploy(await contracts.aqua.getAddress()) as ProAquativeAMM;

        // Deploy SmartYieldVault
        const SmartYieldVault = await ethers.getContractFactory("SmartYieldVault");
        const smartYieldVault = await SmartYieldVault.deploy(
            await customSwapVM.getAddress(),
            await mockAavePool.getAddress(),
            await accounts.owner.getAddress()
        ) as SmartYieldVault;

        // Deploy MockTaker
        const MockTaker = await ethers.getContractFactory("MockTaker");
        const mockTaker = await MockTaker.deploy(
            await contracts.aqua.getAddress(),
            await customSwapVM.getAddress(),
            await accounts.owner.getAddress()
        ) as MockTaker;

        // Setup token amounts
        const mintAmount = ether("10000");
        await tokens.token0.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token0.mint(await accounts.taker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.taker.getAddress(), mintAmount);

        // Mint tokens to vault for initial Aave deposits
        const vaultInitialAmount = ether("5000");
        await tokens.token0.mint(await smartYieldVault.getAddress(), vaultInitialAmount);
        await tokens.token1.mint(await smartYieldVault.getAddress(), vaultInitialAmount);

        // Get IERC20 interfaces for the vault to approve
        const token0Contract = await ethers.getContractAt("IERC20", await tokens.token0.getAddress());
        const token1Contract = await ethers.getContractAt("IERC20", await tokens.token1.getAddress());

        // Approve tokens for vault to use Aave (using impersonation or direct calls)
        // Since we can't sign as the contract, we'll use a helper account to do the initial setup
        // Or we can use hardhat's impersonateAccount feature
        const vaultAddress = await smartYieldVault.getAddress();
        const aavePoolAddress = await mockAavePool.getAddress();

        // Use hardhat's impersonateAccount to sign as the vault
        await ethers.provider.send("hardhat_impersonateAccount", [vaultAddress]);
        const vaultSigner = await ethers.getSigner(vaultAddress);

        // Fund the vault address with ETH for gas
        await (await accounts.owner.sendTransaction({
            to: vaultAddress,
            value: ethers.parseEther("1.0")
        })).wait();

        // Approve tokens for vault to use Aave
        await token0Contract.connect(vaultSigner).approve(aavePoolAddress, ethers.MaxUint256);
        await token1Contract.connect(vaultSigner).approve(aavePoolAddress, ethers.MaxUint256);

        // Initial deposit to Aave (simulating idle funds in Aave)
        const initialAaveDeposit = ether("5000");
        await mockAavePool.connect(vaultSigner).supply(
            await tokens.token0.getAddress(),
            initialAaveDeposit,
            vaultAddress,
            0
        );

        await mockAavePool.connect(vaultSigner).supply(
            await tokens.token1.getAddress(),
            initialAaveDeposit,
            vaultAddress,
            0
        );

        // Stop impersonating
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddress]);

        // Approve tokens for maker to ship liquidity
        await tokens.token0.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);
        await tokens.token1.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);

        // Mint tokens to mockTaker
        await tokens.token0.mint(await mockTaker.getAddress(), mintAmount);
        await tokens.token1.mint(await mockTaker.getAddress(), mintAmount);

        return {
            accounts,
            tokens,
            contracts: {
                ...contracts,
                proAquativeAMM,
                swapVM: customSwapVM,
                mockTaker,
                mockPyth,
                smartYieldVault,
                mockAavePool
            }
        };
    }

    describe("Hook Implementation", function () {
        it("should withdraw from Aave in preTransferOut hook when tokens are needed", async function () {
            const {
                accounts: { maker, taker, owner },
                tokens: { token0, token1 },
                contracts: { aqua, proAquativeAMM, swapVM, mockPyth, smartYieldVault, mockAavePool }
            } = await loadFixture(setupFixture);

            // Setup Pyth price: 1 token0 = 2 token1
            const priceId = ethers.id("TEST_PRICE_ID");
            await mockPyth.setPrice(priceId, 2e8, 1e6, -8);

            // Build order with hooks enabled
            const hookConfig = {
                hasPreTransferInHook: false,
                hasPostTransferInHook: true,
                hasPreTransferOutHook: true,
                hasPostTransferOutHook: false,
                preTransferInTarget: constants.ZERO_ADDRESS,
                postTransferInTarget: await smartYieldVault.getAddress(),
                preTransferOutTarget: await smartYieldVault.getAddress(),
                postTransferOutTarget: constants.ZERO_ADDRESS,
                preTransferInData: "0x",
                postTransferInData: "0x",
                preTransferOutData: "0x",
                postTransferOutData: "0x"
            };

            // Use the overloaded function with hooks - need to specify the function explicitly
            const order = await proAquativeAMM.getFunction("buildProgram(address,address,bytes32,uint64,uint64,bool,uint8,uint8,(bool,bool,bool,bool,address,address,address,address,bytes,bytes,bytes,bytes))")(
                await smartYieldVault.getAddress(), // Vault is the maker
                await mockPyth.getAddress(),
                priceId,
                500000000000000000n,  // k = 0.5
                3600n,
                true,  // tokenIn is base
                18,
                18,
                hookConfig
            );

            // Ship liquidity to Aqua (vault needs to have tokens in Aqua for the swap)
            const token0Liquidity = ether("1000");
            const token1Liquidity = ether("2000");

            const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

            // First, ensure vault has tokens to ship to Aqua
            const vaultAddress = await smartYieldVault.getAddress();
            await token0.mint(vaultAddress, token0Liquidity);
            await token1.mint(vaultAddress, token1Liquidity);

            // Impersonate vault to approve and ship
            await ethers.provider.send("hardhat_impersonateAccount", [vaultAddress]);
            const vaultSigner = await ethers.getSigner(vaultAddress);
            await (await owner.sendTransaction({
                to: vaultAddress,
                value: ethers.parseEther("1.0")
            })).wait();

            // Approve Aqua to pull tokens from vault
            await token0.connect(vaultSigner).approve(await aqua.getAddress(), ethers.MaxUint256);
            await token1.connect(vaultSigner).approve(await aqua.getAddress(), ethers.MaxUint256);

            // Ship all tokens to Aqua
            await aqua.connect(vaultSigner).ship(
                await swapVM.getAddress(),
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(address maker, uint256 traits, bytes data)"],
                    [orderStruct]
                ),
                [await token0.getAddress(), await token1.getAddress()],
                [token0Liquidity, token1Liquidity] // Ship all tokens to Aqua
            );

            // After shipping, move any remaining tokens from vault to Aave
            // This ensures vault has zero balance and all funds are in Aave
            const remainingToken0 = await token0.balanceOf(vaultAddress);
            const remainingToken1 = await token1.balanceOf(vaultAddress);

            if (remainingToken0 > 0) {
                await token0.connect(vaultSigner).approve(await mockAavePool.getAddress(), remainingToken0);
                await mockAavePool.connect(vaultSigner).supply(
                    await token0.getAddress(),
                    remainingToken0,
                    vaultAddress,
                    0
                );
            }

            if (remainingToken1 > 0) {
                await token1.connect(vaultSigner).approve(await mockAavePool.getAddress(), remainingToken1);
                await mockAavePool.connect(vaultSigner).supply(
                    await token1.getAddress(),
                    remainingToken1,
                    vaultAddress,
                    0
                );
            }

            await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddress]);

            // Check initial Aave balance for token1 (should include the 5000 from setup + any remaining after shipping)
            const initialAaveBalance = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token1.getAddress()
            );
            expect(initialAaveBalance).to.be.at.least(ether("5000")); // At least 5000, could be more if there were remaining tokens

            // Check vault's direct token1 balance - should be ZERO since all funds are in Aave
            const vaultDirectBalanceBefore = await token1.balanceOf(await smartYieldVault.getAddress());
            expect(vaultDirectBalanceBefore).to.equal(0); // Vault should have zero balance

            // Execute swap: taker sends token0, expects token1
            const amountIn = ether("100");
            const takerData = TakerTraitsLib.build({
                taker: await taker.getAddress(),
                isExactIn: true,
                threshold: 0n,
                useTransferFromAndAquaPush: true
            });

            await token0.connect(taker).approve(await swapVM.getAddress(), amountIn);

            // Execute swap
            const tx = await swapVM.connect(taker).swap(
                orderStruct,
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                takerData
            );

            // Verify that preTransferOut hook was called and withdrew from Aave
            // The vault should have withdrawn token1 from Aave to fulfill the swap
            const aaveBalanceAfter = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token1.getAddress()
            );

            // Aave balance should have decreased (some tokens were withdrawn)
            expect(aaveBalanceAfter).to.be.lt(initialAaveBalance);
        });

        it("should deposit to Aave in postTransferIn hook after receiving tokens", async function () {
            const {
                accounts: { maker, taker, owner },
                tokens: { token0, token1 },
                contracts: { aqua, proAquativeAMM, swapVM, mockPyth, smartYieldVault, mockAavePool }
            } = await loadFixture(setupFixture);

            // Setup Pyth price: 1 token0 = 2 token1
            const priceId = ethers.id("TEST_PRICE_ID");
            await mockPyth.setPrice(priceId, 2e8, 1e6, -8);

            // Build order with hooks enabled
            const hookConfig = {
                hasPreTransferInHook: false,
                hasPostTransferInHook: true,
                hasPreTransferOutHook: true,
                hasPostTransferOutHook: false,
                preTransferInTarget: constants.ZERO_ADDRESS,
                postTransferInTarget: await smartYieldVault.getAddress(),
                preTransferOutTarget: await smartYieldVault.getAddress(),
                postTransferOutTarget: constants.ZERO_ADDRESS,
                preTransferInData: "0x",
                postTransferInData: "0x",
                preTransferOutData: "0x",
                postTransferOutData: "0x"
            };

            const order = await proAquativeAMM.getFunction("buildProgram(address,address,bytes32,uint64,uint64,bool,uint8,uint8,(bool,bool,bool,bool,address,address,address,address,bytes,bytes,bytes,bytes))")(
                await smartYieldVault.getAddress(),
                await mockPyth.getAddress(),
                priceId,
                500000000000000000n,
                3600n,
                true,
                18,
                18,
                hookConfig
            );

            // Ship liquidity
            const token0Liquidity = ether("1000");
            const token1Liquidity = ether("2000");

            const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

            const vaultAddress = await smartYieldVault.getAddress();
            await token0.mint(vaultAddress, token0Liquidity);
            await token1.mint(vaultAddress, token1Liquidity);

            // Impersonate vault to approve and ship
            await ethers.provider.send("hardhat_impersonateAccount", [vaultAddress]);
            const vaultSigner = await ethers.getSigner(vaultAddress);
            await (await owner.sendTransaction({
                to: vaultAddress,
                value: ethers.parseEther("1.0")
            })).wait();

            await token0.connect(vaultSigner).approve(
                await aqua.getAddress(),
                ethers.MaxUint256
            );
            await token1.connect(vaultSigner).approve(
                await aqua.getAddress(),
                ethers.MaxUint256
            );

            await aqua.connect(vaultSigner).ship(
                await swapVM.getAddress(),
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(address maker, uint256 traits, bytes data)"],
                    [orderStruct]
                ),
                [await token0.getAddress(), await token1.getAddress()],
                [token0Liquidity, token1Liquidity]
            );

            await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddress]);

            // Check initial Aave balance for token0
            const initialAaveBalance = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token0.getAddress()
            );

            // Execute swap: taker sends token0, vault receives token0
            const amountIn = ether("50");
            const takerData = TakerTraitsLib.build({
                taker: await taker.getAddress(),
                isExactIn: true,
                threshold: 0n,
                useTransferFromAndAquaPush: true
            });

            await token0.connect(taker).approve(await swapVM.getAddress(), amountIn);

            // Execute swap
            await swapVM.connect(taker).swap(
                orderStruct,
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                takerData
            );

            // Verify that postTransferIn hook was called and deposited to Aave
            // The vault should have received token0 and deposited it to Aave
            const aaveBalanceAfter = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token0.getAddress()
            );

            // Aave balance should have increased (tokens were deposited)
            expect(aaveBalanceAfter).to.be.gt(initialAaveBalance);
        });

        it("should handle complete swap flow with both hooks", async function () {
            const {
                accounts: { taker, owner },
                tokens: { token0, token1 },
                contracts: { aqua, proAquativeAMM, swapVM, mockPyth, smartYieldVault, mockAavePool }
            } = await loadFixture(setupFixture);

            // Setup Pyth price
            const priceId = ethers.id("TEST_PRICE_ID");
            await mockPyth.setPrice(priceId, 2e8, 1e6, -8);

            // Build order with hooks
            const hookConfig = {
                hasPreTransferInHook: false,
                hasPostTransferInHook: true,
                hasPreTransferOutHook: true,
                hasPostTransferOutHook: false,
                preTransferInTarget: constants.ZERO_ADDRESS,
                postTransferInTarget: await smartYieldVault.getAddress(),
                preTransferOutTarget: await smartYieldVault.getAddress(),
                postTransferOutTarget: constants.ZERO_ADDRESS,
                preTransferInData: "0x",
                postTransferInData: "0x",
                preTransferOutData: "0x",
                postTransferOutData: "0x"
            };

            const order = await proAquativeAMM.getFunction("buildProgram(address,address,bytes32,uint64,uint64,bool,uint8,uint8,(bool,bool,bool,bool,address,address,address,address,bytes,bytes,bytes,bytes))")(
                await smartYieldVault.getAddress(),
                await mockPyth.getAddress(),
                priceId,
                500000000000000000n,
                3600n,
                true,
                18,
                18,
                hookConfig
            );

            // Ship liquidity
            const token0Liquidity = ether("1000");
            const token1Liquidity = ether("2000");
            const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

            const vaultAddress = await smartYieldVault.getAddress();
            await token0.mint(vaultAddress, token0Liquidity);
            await token1.mint(vaultAddress, token1Liquidity);

            // Impersonate vault to approve and ship
            await ethers.provider.send("hardhat_impersonateAccount", [vaultAddress]);
            const vaultSigner = await ethers.getSigner(vaultAddress);
            await (await owner.sendTransaction({
                to: vaultAddress,
                value: ethers.parseEther("1.0")
            })).wait();

            await token0.connect(vaultSigner).approve(
                await aqua.getAddress(),
                ethers.MaxUint256
            );
            await token1.connect(vaultSigner).approve(
                await aqua.getAddress(),
                ethers.MaxUint256
            );

            await aqua.connect(vaultSigner).ship(
                await swapVM.getAddress(),
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(address maker, uint256 traits, bytes data)"],
                    [orderStruct]
                ),
                [await token0.getAddress(), await token1.getAddress()],
                [token0Liquidity, token1Liquidity]
            );

            // After shipping, move any remaining tokens from vault to Aave
            // This ensures vault has zero balance and all funds are in Aave
            const remainingToken0 = await token0.balanceOf(vaultAddress);
            const remainingToken1 = await token1.balanceOf(vaultAddress);

            if (remainingToken0 > 0) {
                await token0.connect(vaultSigner).approve(await mockAavePool.getAddress(), remainingToken0);
                await mockAavePool.connect(vaultSigner).supply(
                    await token0.getAddress(),
                    remainingToken0,
                    vaultAddress,
                    0
                );
            }

            if (remainingToken1 > 0) {
                await token1.connect(vaultSigner).approve(await mockAavePool.getAddress(), remainingToken1);
                await mockAavePool.connect(vaultSigner).supply(
                    await token1.getAddress(),
                    remainingToken1,
                    vaultAddress,
                    0
                );
            }

            await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddress]);

            // Record initial balances
            const initialAaveToken0 = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token0.getAddress()
            );
            const initialAaveToken1 = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token1.getAddress()
            );

            // Execute swap
            const amountIn = ether("100");
            const takerData = TakerTraitsLib.build({
                taker: await taker.getAddress(),
                isExactIn: true,
                threshold: 0n,
                useTransferFromAndAquaPush: true
            });

            await token0.connect(taker).approve(await swapVM.getAddress(), amountIn);

            const tx = await swapVM.connect(taker).swap(
                orderStruct,
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                takerData
            );

            // Verify hooks worked:
            // 1. preTransferOut: token1 should have been withdrawn from Aave
            const finalAaveToken1 = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token1.getAddress()
            );
            expect(finalAaveToken1).to.be.lt(initialAaveToken1);

            // 2. postTransferIn: token0 should have been deposited to Aave
            const finalAaveToken0 = await mockAavePool.getBalance(
                await smartYieldVault.getAddress(),
                await token0.getAddress()
            );
            expect(finalAaveToken0).to.be.gt(initialAaveToken0);

            // Verify swap executed successfully (balance changes confirm this)
            // Note: SwapVM doesn't emit a "Swap" event, so we verify via balance changes
        });
    });
});


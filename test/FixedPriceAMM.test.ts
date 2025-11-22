// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import "@nomicfoundation/hardhat-chai-matchers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer } from 'ethers';
import { expect, ether, constants } from '@1inch/solidity-utils';

// Import fixtures and helpers
import { deployFixture } from "./utils/fixtures";
import { TakerTraitsLib } from "./utils/SwapVMHelpers";

// Import generated types for all contracts
import { Aqua } from '../typechain-types/@1inch/aqua/src/Aqua';
import { FixedPriceAMM } from '../typechain-types/contracts/FixedPriceAMM';
import { CustomSwapVMRouter } from '../typechain-types/contracts/CustomSwapVMRouter';
import { MockTaker } from '../typechain-types/contracts/MockTaker';
import { TokenMock } from '../typechain-types/@1inch/solidity-utils/contracts/mocks/TokenMock';

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
        fixedPriceAMM: FixedPriceAMM;
        swapVM: CustomSwapVMRouter;
        mockTaker: MockTaker;
    };
}

describe("FixedPriceAMM", function () {
    async function setupFixture(): Promise<SetupFixtureResult> {
        const {
            accounts,
            tokens,
            contracts
        } = await deployFixture();

        // Deploy CustomSwapVMRouter (uses MyCustomOpcodes with FixedPriceSwap instruction)
        const CustomSwapVMRouter = await ethers.getContractFactory("CustomSwapVMRouter");
        const customSwapVM = await CustomSwapVMRouter.deploy(
            await contracts.aqua.getAddress(),
            "CustomSwapVM",
            "1.0.0"
        ) as CustomSwapVMRouter;

        // Deploy FixedPriceAMM
        const FixedPriceAMM = await ethers.getContractFactory("FixedPriceAMM");
        const fixedPriceAMM = await FixedPriceAMM.deploy(await contracts.aqua.getAddress()) as FixedPriceAMM;

        // Setup token amounts first (before deploying mockTaker)
        const mintAmount = ether("1000");
        await tokens.token0.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.taker.getAddress(), mintAmount);

        // Deploy MockTaker with custom router
        const MockTaker = await ethers.getContractFactory("MockTaker");
        const mockTaker = await MockTaker.deploy(
            await contracts.aqua.getAddress(),
            await customSwapVM.getAddress(),
            await accounts.owner.getAddress()
        ) as MockTaker;

        // Mint tokens to the new mockTaker
        await tokens.token1.mint(await mockTaker.getAddress(), mintAmount);

        // Approve tokens for maker
        await tokens.token0.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);
        await tokens.token1.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);

        return {
            accounts,
            tokens,
            contracts: {
                ...contracts,
                fixedPriceAMM,
                swapVM: customSwapVM,
                mockTaker
            }
        };
    }

    describe("Fixed Price Swap (1:1)", function () {
        it("should execute a fixed price swap (1:1 ratio)", async function () {
            const {
                accounts: { maker },
                tokens: { token0, token1 },
                contracts: { aqua, fixedPriceAMM, swapVM, mockTaker }
            } = await loadFixture(setupFixture);

            // Build order with FixedPriceAMM
            const order = await fixedPriceAMM.buildProgram(
                await maker.getAddress()
            );

            // Ship liquidity to Aqua
            // For fixed price: always swaps at 1:1 ratio regardless of reserves
            const token0Liquidity = ether("100");
            const token1Liquidity = ether("200");

            const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

            await aqua.connect(maker).ship(
                await swapVM.getAddress(),
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(address maker, uint256 traits, bytes data)"],
                    [orderStruct]
                ),
                [await token0.getAddress(), await token1.getAddress()],
                [token0Liquidity, token1Liquidity]
            );

            // Build taker traits data
            const takerData = TakerTraitsLib.build({
                taker: await mockTaker.getAddress(),
                isExactIn: true,
                threshold: ether("45"), // Minimum output (should get 50, so this should pass)
                hasPreTransferInCallback: true,
                preTransferInCallbackData: "0x",
                useTransferFromAndAquaPush: false // Use callback instead
            });

            // Swap 50 token1 for token0
            // Expected: Fixed price always swaps 1:1, so 50 token1 = 50 token0
            const amountIn = ether("50");
            const expectedAmountOut = ether("50"); // 1:1 ratio

            const tx = await mockTaker.swap(
                orderStruct,
                await token1.getAddress(),
                await token0.getAddress(),
                amountIn,
                takerData
            );

            // Verify token balances changed correctly
            await expect(tx).to.changeTokenBalances(
                token1,
                [await mockTaker.getAddress(), await maker.getAddress()],
                [-amountIn, amountIn]
            );

            // Verify token0 balances (taker should receive 50, maker should lose 50)
            await expect(tx).to.changeTokenBalances(
                token0,
                [await mockTaker.getAddress(), await maker.getAddress()],
                [expectedAmountOut, -expectedAmountOut]
            );
        });

        it("should execute swap with EOA as taker", async function () {
            const {
                accounts: { maker, taker },
                tokens: { token0, token1 },
                contracts: { aqua, fixedPriceAMM, swapVM }
            } = await loadFixture(setupFixture);

            // Build order
            const order = await fixedPriceAMM.buildProgram(
                await maker.getAddress()
            );

            const takerData = TakerTraitsLib.build({
                taker: await taker.getAddress(),
                isExactIn: true,
                threshold: ether("45"), // Should get 50, so this passes
                useTransferFromAndAquaPush: true
            });

            const token0Liquidity = ether("100");
            const token1Liquidity = ether("200");

            const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

            await aqua.connect(maker).ship(
                await swapVM.getAddress(),
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(address maker, uint256 traits, bytes data)"],
                    [orderStruct]
                ),
                [await token0.getAddress(), await token1.getAddress()],
                [token0Liquidity, token1Liquidity]
            );

            const amountIn = ether("50");
            const expectedAmountOut = ether("50"); // 1:1 ratio

            await token1.connect(taker).approve(await swapVM.getAddress(), amountIn);

            const tx = await swapVM.connect(taker).swap(
                orderStruct,
                await token1.getAddress(),
                await token0.getAddress(),
                amountIn,
                takerData
            );

            // Verify balances changed correctly
            await expect(tx).to.changeTokenBalances(
                token1,
                [await taker.getAddress(), await maker.getAddress()],
                [-amountIn, amountIn]
            );

            await expect(tx).to.changeTokenBalances(
                token0,
                [await taker.getAddress(), await maker.getAddress()],
                [expectedAmountOut, -expectedAmountOut]
            );
        });

        it("should fail if insufficient balance for fixed price swap", async function () {
            const {
                accounts: { maker },
                tokens: { token0, token1 },
                contracts: { aqua, fixedPriceAMM, swapVM, mockTaker }
            } = await loadFixture(setupFixture);

            // Build order
            const order = await fixedPriceAMM.buildProgram(
                await maker.getAddress()
            );

            // Ship liquidity with very small token0 balance
            // This will test the insufficient balance check
            const token0Liquidity = ether("10"); // Only 10 token0
            const token1Liquidity = ether("200");

            const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

            await aqua.connect(maker).ship(
                await swapVM.getAddress(),
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(address maker, uint256 traits, bytes data)"],
                    [orderStruct]
                ),
                [await token0.getAddress(), await token1.getAddress()],
                [token0Liquidity, token1Liquidity]
            );

            const takerData = TakerTraitsLib.build({
                taker: await mockTaker.getAddress(),
                isExactIn: true,
                threshold: ether("1"),
                hasPreTransferInCallback: true,
                preTransferInCallbackData: "0x"
            });

            // Try to swap 50 token1 (which would require 50 token0, but only 10 available)
            const amountIn = ether("50");

            // This should fail because we don't have enough token0 balance
            // The error comes from FixedPriceSwap instruction, not the AMM contract
            await expect(
                mockTaker.swap(
                    orderStruct,
                    await token1.getAddress(),
                    await token0.getAddress(),
                    amountIn,
                    takerData
                )
            ).to.be.reverted; // The error is from the instruction, which may not be directly accessible
        });

        it("should execute exactOut swap (1:1 ratio)", async function () {
            const {
                accounts: { maker },
                tokens: { token0, token1 },
                contracts: { aqua, fixedPriceAMM, swapVM, mockTaker }
            } = await loadFixture(setupFixture);

            // Build order
            const order = await fixedPriceAMM.buildProgram(
                await maker.getAddress()
            );

            const token0Liquidity = ether("100");
            const token1Liquidity = ether("200");

            const orderStruct = { maker: order.maker, traits: order.traits, data: order.data };

            await aqua.connect(maker).ship(
                await swapVM.getAddress(),
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["tuple(address maker, uint256 traits, bytes data)"],
                    [orderStruct]
                ),
                [await token0.getAddress(), await token1.getAddress()],
                [token0Liquidity, token1Liquidity]
            );

            // Build taker traits for exactOut
            const takerData = TakerTraitsLib.build({
                taker: await mockTaker.getAddress(),
                isExactIn: false, // exactOut
                threshold: ether("55"), // Maximum input (should need 50, so 55 should pass)
                hasPreTransferInCallback: true,
                preTransferInCallbackData: "0x",
                useTransferFromAndAquaPush: false // Use callback instead
            });

            // Want 50 token0 out, should need 50 token1 in (1:1 ratio)
            const amountOut = ether("50");
            const expectedAmountIn = ether("50"); // 1:1 ratio

            const tx = await mockTaker.swap(
                orderStruct,
                await token1.getAddress(),
                await token0.getAddress(),
                amountOut, // In exactOut mode, this is the desired output
                takerData
            );

            // Verify balances
            await expect(tx).to.changeTokenBalances(
                token1,
                [await mockTaker.getAddress(), await maker.getAddress()],
                [-expectedAmountIn, expectedAmountIn]
            );

            await expect(tx).to.changeTokenBalances(
                token0,
                [await mockTaker.getAddress(), await maker.getAddress()],
                [amountOut, -amountOut]
            );
        });
    });
});


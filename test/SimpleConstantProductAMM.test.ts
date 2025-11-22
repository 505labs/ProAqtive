// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import "@nomicfoundation/hardhat-chai-matchers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer } from 'ethers';
import { expect, ether, constants, time } from '@1inch/solidity-utils';

// Import fixtures and helpers
import { deployFixture } from "./utils/fixtures";
import { TakerTraitsLib } from "./utils/SwapVMHelpers";

// Import generated types for all contracts
import { Aqua } from '../typechain-types/@1inch/aqua/src/Aqua';
import { SimpleConstantProductAMM } from '../typechain-types/contracts/SimpleConstantProductAMM';
import { AquaSwapVMRouter } from '../typechain-types/@1inch/swap-vm/src/routers/AquaSwapVMRouter';
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
        simpleAMM: SimpleConstantProductAMM;
        swapVM: AquaSwapVMRouter;
        mockTaker: MockTaker;
    };
}

describe("SimpleConstantProductAMM", function () {
    async function setupFixture(): Promise<SetupFixtureResult> {
        const {
            accounts,
            tokens,
            contracts
        } = await deployFixture();

        // Deploy SimpleConstantProductAMM
        const SimpleConstantProductAMM = await ethers.getContractFactory("SimpleConstantProductAMM");
        const simpleAMM = await SimpleConstantProductAMM.deploy(await contracts.aqua.getAddress()) as SimpleConstantProductAMM;

        // Setup token amounts
        const mintAmount = ether("1000");
        await tokens.token0.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token1.mint(await contracts.mockTaker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.taker.getAddress(), mintAmount);

        // Approve tokens for maker
        await tokens.token0.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);
        await tokens.token1.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);

        return {
            accounts,
            tokens,
            contracts: {
                ...contracts,
                simpleAMM
            }
        };
    }

    describe("Constant Product Swap", function () {
        it("should execute a simple constant product swap", async function () {
            const {
                accounts: { maker },
                tokens: { token0, token1 },
                contracts: { aqua, simpleAMM, swapVM, mockTaker }
            } = await loadFixture(setupFixture);

            // Build order with SimpleConstantProductAMM (no parameters needed except maker)
            const order = await simpleAMM.buildProgram(
                await maker.getAddress()
            );

            // Ship liquidity to Aqua
            // For constant product: reserve0 * reserve1 = constant
            // Initial reserves: 100 token0, 200 token1
            // Constant k = 100 * 200 = 20,000
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
                threshold: ether("15"), // Minimum output
                hasPreTransferInCallback: true,
                preTransferInCallbackData: "0x"
            });

            // Swap 50 token1 for token0
            // Expected calculation (constant product):
            // Before: 100 token0, 200 token1 (k = 20,000)
            // After: (100 + x) token0, (200 - 50) token1 = 150 token1
            // k = (100 + x) * 150 = 20,000
            // 100 + x = 20,000 / 150 = 133.33...
            // x = 33.33... token0
            const amountIn = ether("50");

            const tx = await mockTaker.swap(
                orderStruct,
                await token1.getAddress(),
                await token0.getAddress(),
                amountIn,
                takerData
            );

            // Verify token balances changed
            await expect(tx).to.changeTokenBalances(
                token1,
                [await mockTaker.getAddress(), await maker.getAddress()],
                [-amountIn, amountIn]
            );
        });

        it("should execute swap with EOA as taker", async function () {
            const {
                accounts: { maker, taker },
                tokens: { token0, token1 },
                contracts: { aqua, simpleAMM, swapVM }
            } = await loadFixture(setupFixture);

            // Build simple order
            const order = await simpleAMM.buildProgram(
                await maker.getAddress()
            );

            const takerData = TakerTraitsLib.build({
                taker: await taker.getAddress(),
                isExactIn: true,
                threshold: ether("15"),
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

            await token1.connect(taker).approve(await swapVM.getAddress(), amountIn);

            const tx = await swapVM.connect(taker).swap(
                orderStruct,
                await token1.getAddress(),
                await token0.getAddress(),
                amountIn,
                takerData
            );

            await expect(tx).to.changeTokenBalances(
                token1,
                [await taker.getAddress(), await maker.getAddress()],
                [-amountIn, amountIn]
            );
        });
    });
});


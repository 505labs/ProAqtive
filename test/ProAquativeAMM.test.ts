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
import { ProAquativeAMM } from '../typechain-types/contracts/ProAquativeAMM';
import { CustomSwapVMRouter } from '../typechain-types/contracts/CustomSwapVMRouter';
import { MockTaker } from '../typechain-types/contracts/MockTaker';
import { TokenMock } from '../typechain-types/@1inch/solidity-utils/contracts/mocks/TokenMock';
import { MockPyth } from '../typechain-types/contracts/mocks/MockPyth';

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
    };
}

describe("ProAquativeAMM", function () {
    async function setupFixture(): Promise<SetupFixtureResult> {
        const {
            accounts,
            tokens,
            contracts
        } = await deployFixture();

        // Deploy MockPyth
        const MockPyth = await ethers.getContractFactory("MockPyth");
        const mockPyth = await MockPyth.deploy() as MockPyth;

        // Deploy CustomSwapVMRouter (uses MyCustomOpcodes with ProAquativeMM instruction)
        const CustomSwapVMRouter = await ethers.getContractFactory("CustomSwapVMRouter");
        const customSwapVM = await CustomSwapVMRouter.deploy(
            await contracts.aqua.getAddress(),
            "CustomSwapVM",
            "1.0.0"
        ) as CustomSwapVMRouter;

        // Deploy ProAquativeAMM
        const ProAquativeAMM = await ethers.getContractFactory("ProAquativeAMM");
        const proAquativeAMM = await ProAquativeAMM.deploy(await contracts.aqua.getAddress()) as ProAquativeAMM;

        // Deploy MockTaker with custom router
        const MockTaker = await ethers.getContractFactory("MockTaker");
        const mockTaker = await MockTaker.deploy(
            await contracts.aqua.getAddress(),
            await customSwapVM.getAddress(),
            await accounts.owner.getAddress()
        ) as MockTaker;

        // Setup token amounts
        const mintAmount = ether("1000");
        await tokens.token0.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.maker.getAddress(), mintAmount);
        await tokens.token0.mint(await accounts.taker.getAddress(), mintAmount);
        await tokens.token1.mint(await accounts.taker.getAddress(), mintAmount);

        // Approve tokens for maker
        await tokens.token0.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);
        await tokens.token1.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);

        // Mint tokens to the new mockTaker (needs token0 to swap for token1)
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
                mockPyth
            }
        };
    }

    describe("ProAquativeMM Swap", function () {
        it("should execute a ProAquativeMM swap with oracle price", async function () {
            const {
                accounts: { maker },
                tokens: { token0, token1 },
                contracts: { aqua, proAquativeAMM, swapVM, mockTaker, mockPyth }
            } = await loadFixture(setupFixture);

            // Setup Pyth price: 1 token0 = 2 token1 (price = 2e8 with expo = -8)
            // Price in Pyth: price * 10^expo = 2e8 * 10^-8 = 2.0
            const priceId = ethers.id("TEST_PRICE_ID");
            await mockPyth.setPrice(
                priceId,
                2e8,  // price: 2 * 10^8
                1e6,  // confidence: 0.01%
                -8    // exponent: -8 (so price = 2e8 * 10^-8 = 2.0)
            );

            // Build order with ProAquativeAMM
            // token0 is base, token1 is quote
            // k = 0.5 (50% liquidity depth impact)
            // Note: k is uint64, so we use 500000000000000000 (0.5 * 1e18) but as uint64
            const order = await proAquativeAMM.buildProgram(
                await maker.getAddress(),
                await mockPyth.getAddress(),
                priceId,
                500000000000000000n,  // k = 0.5 (50%) as uint64
                3600n,  // maxStaleness = 1 hour
                true,  // tokenIn is base (token0)
                18,    // baseDecimals = 18
                18     // quoteDecimals = 18
            );

            // Ship liquidity to Aqua
            const token0Liquidity = ether("100"); // 100 base tokens
            const token1Liquidity = ether("200"); // 200 quote tokens (1:2 ratio)

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
            // Note: ProAquativeMM with k=0.5 gives less output than pure oracle price
            // Setting low threshold to allow the swap
            const takerData = TakerTraitsLib.build({
                taker: await mockTaker.getAddress(),
                isExactIn: true,
                threshold: 0n, // Minimum output (allow any amount for testing)
                hasPreTransferInCallback: true,
                preTransferInCallbackData: "0x",
                useTransferFromAndAquaPush: false
            });

            // Swap 10 token0 (base) for token1 (quote)
            const amountIn = ether("10");

            const tx = await mockTaker.swap(
                orderStruct,
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                takerData
            );

            // Verify token balances changed
            await expect(tx).to.changeTokenBalances(
                token0,
                [await mockTaker.getAddress(), await maker.getAddress()],
                [-amountIn, amountIn]
            );
        });

        it("should execute swap with EOA as taker", async function () {
            const {
                accounts: { maker, taker },
                tokens: { token0, token1 },
                contracts: { aqua, proAquativeAMM, swapVM, mockPyth }
            } = await loadFixture(setupFixture);

            // Setup Pyth price: 1 token0 = 2 token1
            const priceId = ethers.id("TEST_PRICE_ID");
            await mockPyth.setPrice(priceId, 2e8, 1e6, -8);

            // Build order
            const order = await proAquativeAMM.buildProgram(
                await maker.getAddress(),
                await mockPyth.getAddress(),
                priceId,
                500000000000000000n,  // k = 0.5
                3600n,
                true,  // tokenIn is base
                18,
                18
            );

            const takerData = TakerTraitsLib.build({
                taker: await taker.getAddress(),
                isExactIn: true,
                threshold: 0n, // Allow any amount for testing
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

            const amountIn = ether("10");

            await token0.connect(taker).approve(await swapVM.getAddress(), amountIn);

            const tx = await swapVM.connect(taker).swap(
                orderStruct,
                await token0.getAddress(),
                await token1.getAddress(),
                amountIn,
                takerData
            );

            await expect(tx).to.changeTokenBalances(
                token0,
                [await taker.getAddress(), await maker.getAddress()],
                [-amountIn, amountIn]
            );
        });

        it("should fail with stale price", async function () {
            const {
                accounts: { maker },
                tokens: { token0, token1 },
                contracts: { aqua, proAquativeAMM, swapVM, mockTaker, mockPyth }
            } = await loadFixture(setupFixture);

            const priceId = ethers.id("TEST_PRICE_ID");
            await mockPyth.setPrice(priceId, 2e8, 1e6, -8);

            // Build order with very short maxStaleness (1 second)
            const order = await proAquativeAMM.buildProgram(
                await maker.getAddress(),
                await mockPyth.getAddress(),
                priceId,
                500000000000000000n,  // k = 0.5
                1n,  // maxStaleness = 1 second
                true,
                18,
                18
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

            // Wait 2 seconds to make price stale
            await new Promise(resolve => setTimeout(resolve, 2000));

            const takerData = TakerTraitsLib.build({
                taker: await mockTaker.getAddress(),
                isExactIn: true,
                threshold: ether("1"),
                hasPreTransferInCallback: true,
                preTransferInCallbackData: "0x",
                useTransferFromAndAquaPush: false
            });

            const amountIn = ether("10");

            // Should fail because price is stale
            await expect(
                mockTaker.swap(
                    orderStruct,
                    await token0.getAddress(),
                    await token1.getAddress(),
                    amountIn,
                    takerData
                )
            ).to.be.reverted;
        });
    });
});


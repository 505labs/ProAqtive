// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import "@nomicfoundation/hardhat-chai-matchers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer } from 'ethers';
import { expect, ether, constants, time, timeIncreaseTo } from '@1inch/solidity-utils';

// Import fixtures and helpers
import { deployFixture } from "./utils/fixtures";
import { TakerTraitsLib } from "./utils/SwapVMHelpers";

// Import generated types for all contracts
import { Aqua } from '../typechain-types/@1inch/aqua/src/Aqua';
import { AquaAMM } from '../typechain-types/contracts/AquaAMM';
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
    aquaAMM: AquaAMM;
    swapVM: AquaSwapVMRouter;
    mockTaker: MockTaker;
  };
}

describe("AquaAMM", function () {
  async function setupFixture(): Promise<SetupFixtureResult> {
    const {
      accounts,
      tokens,
      contracts
    } = await deployFixture();

    // Setup token amounts
    const mintAmount = ether("1000");
    await tokens.token0.mint(await accounts.maker.getAddress(), mintAmount);
    await tokens.token1.mint(await accounts.maker.getAddress(), mintAmount);
    await tokens.token1.mint(await contracts.mockTaker.getAddress(), mintAmount);
    await tokens.token1.mint(await accounts.taker.getAddress(), mintAmount);

    // Approve tokens for maker
    await tokens.token0.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);
    await tokens.token1.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);

    // Note: MockTaker handles token approvals internally in its preTransferInCallback

    return {
      accounts,
      tokens,
      contracts
    };
  }

  describe("XYC Swap with AquaAMM", function () {
    it("should execute swap with resolver contract", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, aquaAMM, swapVM, mockTaker }
      } = await loadFixture(setupFixture);

      // Build order with AquaAMM
      const feeBpsIn = 0n; // No fee
      const delta0 = 0n; // No concentration
      const delta1 = 0n; // No concentration
      const decayPeriod = 0n; // No decay
      const protocolFeeBpsIn = 0n; // No protocol fee
      const salt = 0n;
      const deadline = 0n;

      const order = await aquaAMM.buildProgram(
        await maker.getAddress(),
        await token0.getAddress(),
        await token1.getAddress(),
        feeBpsIn,
        delta0,
        delta1,
        decayPeriod,
        protocolFeeBpsIn,
        constants.ZERO_ADDRESS, // No fee receiver
        salt,
        deadline
      );

      // Build taker traits data
      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: ether("15"),
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x" // Empty callback data
      });

      // Ship liquidity to Aqua
      const token0Liquidity = ether("100");
      const token1Liquidity = ether("200");

      // Create a new array to avoid read-only issues
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

      const tx = await mockTaker.swap(
        orderStruct,
        await token1.getAddress(),
        await token0.getAddress(),
        amountIn,
        takerData
      );

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
        contracts: { aqua, aquaAMM, swapVM }
      } = await loadFixture(setupFixture);

      const feeBpsIn = 0n;
      const delta0 = 0n;
      const delta1 = 0n;
      const decayPeriod = 0n;
      const protocolFeeBpsIn = 0n;
      const salt = 1n;
      const deadline = 0n;

      const order = await aquaAMM.buildProgram(
        await maker.getAddress(),
        await token0.getAddress(),
        await token1.getAddress(),
        feeBpsIn,
        delta0,
        delta1,
        decayPeriod,
        protocolFeeBpsIn,
        constants.ZERO_ADDRESS, // No fee receiver
        salt,
        deadline
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

    it.only("should not swap tokens after deadline", async function () {
      const {
        accounts: { maker, taker },
        tokens: { token0, token1 },
        contracts: { aqua, aquaAMM, swapVM }
      } = await loadFixture(setupFixture);

      const feeBpsIn = 0n;
      const delta0 = 0n;
      const delta1 = 0n;
      const decayPeriod = 0n;
      const protocolFeeBpsIn = 0n;
      const salt = 1n;
      const deadline = await time.latest() + 86400;

      const order = await aquaAMM.buildProgram(
        await maker.getAddress(),
        await token0.getAddress(),
        await token1.getAddress(),
        feeBpsIn,
        delta0,
        delta1,
        decayPeriod,
        protocolFeeBpsIn,
        constants.ZERO_ADDRESS, // No fee receiver
        salt,
        deadline
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

      await timeIncreaseTo(await time.latest() + 86401);
      await expect(swapVM.connect(taker).swap(
        orderStruct,
        await token1.getAddress(),
        await token0.getAddress(),
        amountIn,
        takerData
      )).to.be.revertedWithCustomError(aquaAMM, 'DeadlineReached');
    });
  });
});

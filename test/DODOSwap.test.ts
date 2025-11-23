// SPDX-License-Identifier: Apache-2.0

import "@nomicfoundation/hardhat-chai-matchers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer } from 'ethers';
import { expect, ether } from '@1inch/solidity-utils';

// Import fixtures and helpers
import { deployFixture } from "./utils/fixtures";
import { TakerTraitsLib, MakerTraitsLib } from "./utils/SwapVMHelpers";
import { ProgramBuilder } from "./utils/ProgramBuilder";

// Import generated types for all contracts
import { Aqua } from '../typechain-types/@1inch/aqua/src/Aqua';
import { MyCustomOpcodes } from '../typechain-types/contracts/MyCustomOpcodes';
import { CustomSwapVMRouter } from '../typechain-types/contracts/CustomSwapVMRouter';
import { MockTaker } from '../typechain-types/contracts/MockTaker';
import { TokenMock } from '../typechain-types/@1inch/solidity-utils/contracts/mocks/TokenMock';

const { ethers } = require("hardhat");

interface DODOSwapFixtureResult {
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
    customOpcodes: MyCustomOpcodes;
    swapVM: CustomSwapVMRouter;
    mockTaker: MockTaker;
    mockOracle: any;
  };
}

describe("DODOSwap", function () {
  const DODO_SWAP_OPCODE = 0x1E; // Index 30 in MyCustomOpcodes

  async function setupDODOFixture(): Promise<DODOSwapFixtureResult> {
    const {
      accounts,
      tokens,
      contracts
    } = await deployFixture();

    // Deploy MockPriceOracle with initial price of 1:1 (1e18)
    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const mockOracle = await MockPriceOracle.deploy(ether("1"));

    // Deploy MyCustomOpcodes (includes DODOSwap)
    const MyCustomOpcodesFactory = await ethers.getContractFactory("MyCustomOpcodes");
    const customOpcodes = await MyCustomOpcodesFactory.deploy(await contracts.aqua.getAddress());

    // Setup token amounts
    const mintAmount = ether("10000");
    await tokens.token0.mint(await accounts.maker.getAddress(), mintAmount);
    await tokens.token1.mint(await accounts.maker.getAddress(), mintAmount);
    await tokens.token1.mint(await contracts.mockTaker.getAddress(), mintAmount);
    await tokens.token0.mint(await contracts.mockTaker.getAddress(), mintAmount);

    // Approve tokens for maker
    await tokens.token0.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);
    await tokens.token1.connect(accounts.maker).approve(await contracts.aqua.getAddress(), ethers.MaxUint256);

    return {
      accounts,
      tokens,
      contracts: {
        ...contracts,
        customOpcodes,
        mockOracle
      }
    };
  }

  describe("R = ONE (Balanced State)", function () {
    it("should execute exact input swap (sell base for quote) when R = ONE", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      // Set oracle price to 1:1
      await mockOracle.setPrice(ether("1"));

      // Set liquidity at equilibrium
      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");

      // Ship liquidity to Aqua (balanced state)
      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"), // k = 0.5
        true // baseIsTokenIn
      );

      // Execute swap: sell base (token0) for quote (token1)
      const amountIn = ether("100");
      const minAmountOut = ether("90"); // Allow some slippage

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        true
      );

      const tx = await mockTaker.swap(
        orderStruct,
        await token0.getAddress(),
        await token1.getAddress(),
        amountIn,
        takerData
      );

      // Verify tokens were transferred
      await expect(tx).to.changeTokenBalances(
        token0,
        [await mockTaker.getAddress(), await maker.getAddress()],
        [-amountIn, amountIn]
      );
    });

    it("should execute exact output swap (buy base with quote) when R = ONE", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        false // quoteIsTokenIn
      );

      // Execute swap: buy base (token0) with quote (token1)
      const amountOut = ether("50");
      const maxAmountIn = ether("60"); // Allow some slippage

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: false,
        threshold: maxAmountIn,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        false
      );

      const tx = await mockTaker.swap(
        orderStruct,
        await token1.getAddress(),
        await token0.getAddress(),
        amountOut,
        takerData
      );

      // Verify tokens were transferred
      await expect(tx).to.changeTokenBalances(
        token0,
        [await mockTaker.getAddress(), await maker.getAddress()],
        [amountOut, -amountOut]
      );
    });
  });

  describe("R < ONE (Excess Base)", function () {
    it("should execute exact input swap (sell base for quote) when R < ONE", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      // Set state with excess base (B > B₀)
      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");
      const actualBaseAmount = ether("1500"); // Excess base
      const actualQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        actualBaseAmount,
        actualQuoteAmount,
        mockOracle,
        ether("0.5"),
        true,
        targetBaseAmount,
        targetQuoteAmount
      );

      const amountIn = ether("100");
      const minAmountOut = ether("80");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        true
      );

      const tx = await mockTaker.swap(
        orderStruct,
        await token0.getAddress(),
        await token1.getAddress(),
        amountIn,
        takerData
      );

      await expect(tx).to.changeTokenBalances(
        token0,
        [await mockTaker.getAddress(), await maker.getAddress()],
        [-amountIn, amountIn]
      );
    });

    it("should execute exact output swap (buy base with quote) when R < ONE", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");
      const actualBaseAmount = ether("1500");
      const actualQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        actualBaseAmount,
        actualQuoteAmount,
        mockOracle,
        ether("0.5"),
        false,
        targetBaseAmount,
        targetQuoteAmount
      );

      const amountOut = ether("50");
      const maxAmountIn = ether("60");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: false,
        threshold: maxAmountIn,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        false
      );

      const tx = await mockTaker.swap(
        orderStruct,
        await token1.getAddress(),
        await token0.getAddress(),
        amountOut,
        takerData
      );

      await expect(tx).to.changeTokenBalances(
        token0,
        [await mockTaker.getAddress(), await maker.getAddress()],
        [amountOut, -amountOut]
      );
    });
  });

  describe("R > ONE (Excess Quote)", function () {
    it("should execute exact input swap (sell base for quote) when R > ONE", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      // Set state with excess quote (Q > Q₀)
      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");
      const actualBaseAmount = ether("1000");
      const actualQuoteAmount = ether("1500"); // Excess quote

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        actualBaseAmount,
        actualQuoteAmount,
        mockOracle,
        ether("0.5"),
        true,
        targetBaseAmount,
        targetQuoteAmount
      );

      const amountIn = ether("100");
      const minAmountOut = ether("80");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        true
      );

      const tx = await mockTaker.swap(
        orderStruct,
        await token0.getAddress(),
        await token1.getAddress(),
        amountIn,
        takerData
      );

      await expect(tx).to.changeTokenBalances(
        token0,
        [await mockTaker.getAddress(), await maker.getAddress()],
        [-amountIn, amountIn]
      );
    });

    it("should execute exact output swap (buy base with quote) when R > ONE", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");
      const actualBaseAmount = ether("1000");
      const actualQuoteAmount = ether("1500");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        actualBaseAmount,
        actualQuoteAmount,
        mockOracle,
        ether("0.5"),
        false,
        targetBaseAmount,
        targetQuoteAmount
      );

      const amountOut = ether("50");
      const maxAmountIn = ether("60");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: false,
        threshold: maxAmountIn,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        false
      );

      const tx = await mockTaker.swap(
        orderStruct,
        await token1.getAddress(),
        await token0.getAddress(),
        amountOut,
        takerData
      );

      await expect(tx).to.changeTokenBalances(
        token0,
        [await mockTaker.getAddress(), await maker.getAddress()],
        [amountOut, -amountOut]
      );
    });
  });

  describe("Different K Values", function () {
    it("should work with k = 0 (constant sum behavior)", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0"), // k = 0
        true
      );

      const amountIn = ether("100");
      const minAmountOut = ether("90");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0"),
        true
      );

      await expect(
        mockTaker.swap(
          orderStruct,
          await token0.getAddress(),
          await token1.getAddress(),
          amountIn,
          takerData
        )
      ).to.not.be.reverted;
    });

    it("should work with k = 1 (constant product behavior)", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("1"), // k = 1
        true
      );

      const amountIn = ether("100");
      const minAmountOut = ether("80");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("1"),
        true
      );

      await expect(
        mockTaker.swap(
          orderStruct,
          await token0.getAddress(),
          await token1.getAddress(),
          amountIn,
          takerData
        )
      ).to.not.be.reverted;
    });
  });

  describe("Different Oracle Prices", function () {
    it("should respect oracle price when base is more valuable (price > 1)", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      // Set oracle price to 2:1 (base is 2x more valuable)
      await mockOracle.setPrice(ether("2"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        true
      );

      const amountIn = ether("100");
      const minAmountOut = ether("150");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        true
      );

      await expect(
        mockTaker.swap(
          orderStruct,
          await token0.getAddress(),
          await token1.getAddress(),
          amountIn,
          takerData
        )
      ).to.not.be.reverted;
    });

    it("should respect oracle price when base is less valuable (price < 1)", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      // Set oracle price to 0.5:1 (base is half as valuable)
      await mockOracle.setPrice(ether("0.5"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        true
      );

      const amountIn = ether("100");
      const minAmountOut = ether("30");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        true
      );

      await expect(
        mockTaker.swap(
          orderStruct,
          await token0.getAddress(),
          await token1.getAddress(),
          amountIn,
          takerData
        )
      ).to.not.be.reverted;
    });
  });

  describe("Error Cases", function () {
    it("should revert with invalid k parameter (k > 1)", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("1.5"), // Invalid k > 1
        true
      );

      const amountIn = ether("100");
      const minAmountOut = ether("90");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: true,
        threshold: minAmountOut,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("1.5"),
        true
      );

      await expect(
        mockTaker.swap(
          orderStruct,
          await token0.getAddress(),
          await token1.getAddress(),
          amountIn,
          takerData
        )
      ).to.be.revertedWithCustomError(customOpcodes, "DODOSwapInvalidKParameter");
    });

    it("should revert when trying to buy more than available liquidity", async function () {
      const {
        accounts: { maker },
        tokens: { token0, token1 },
        contracts: { aqua, customOpcodes, swapVM, mockTaker, mockOracle }
      } = await loadFixture(setupDODOFixture);

      await mockOracle.setPrice(ether("1"));

      const targetBaseAmount = ether("1000");
      const targetQuoteAmount = ether("1000");
      const actualBaseAmount = ether("1000");
      const actualQuoteAmount = ether("1000");

      await setupDODOOrder(
        aqua,
        swapVM,
        customOpcodes,
        maker,
        token0,
        token1,
        actualBaseAmount,
        actualQuoteAmount,
        mockOracle,
        ether("0.5"),
        false,
        targetBaseAmount,
        targetQuoteAmount
      );

      // Try to buy more than available
      const amountOut = ether("1100");
      const maxAmountIn = ether("2000");

      const takerData = TakerTraitsLib.build({
        taker: await mockTaker.getAddress(),
        isExactIn: false,
        threshold: maxAmountIn,
        hasPreTransferInCallback: true,
        preTransferInCallbackData: "0x"
      });

      const orderStruct = await buildDODOOrderStruct(
        maker,
        token0,
        token1,
        customOpcodes,
        targetBaseAmount,
        targetQuoteAmount,
        mockOracle,
        ether("0.5"),
        false
      );

      await expect(
        mockTaker.swap(
          orderStruct,
          await token1.getAddress(),
          await token0.getAddress(),
          amountOut,
          takerData
        )
      ).to.be.revertedWithCustomError(customOpcodes, "DODOSwapInsufficientLiquidity");
    });
  });
});

// Helper functions

async function setupDODOOrder(
  aqua: any,
  swapVM: any,
  customOpcodes: any,
  maker: Signer,
  token0: any,
  token1: any,
  actualBaseAmount: any,
  actualQuoteAmount: any,
  mockOracle: any,
  k: any,
  baseIsTokenIn: boolean,
  targetBaseAmount?: any,
  targetQuoteAmount?: any
) {
  const orderStruct = await buildDODOOrderStruct(
    maker,
    token0,
    token1,
    customOpcodes,
    targetBaseAmount || actualBaseAmount,
    targetQuoteAmount || actualQuoteAmount,
    mockOracle,
    k,
    baseIsTokenIn
  );

  await aqua.connect(maker).ship(
    await swapVM.getAddress(),
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address maker, uint256 traits, bytes data)"],
      [orderStruct]
    ),
    [await token0.getAddress(), await token1.getAddress()],
    [actualBaseAmount, actualQuoteAmount]
  );
}

async function buildDODOOrderStruct(
  maker: Signer,
  token0: any,
  token1: any,
  customOpcodes: any,
  targetBaseAmount: any,
  targetQuoteAmount: any,
  mockOracle: any,
  k: any,
  baseIsTokenIn: boolean
) {
  const DODO_SWAP_OPCODE = 0x1E;

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


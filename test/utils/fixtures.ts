// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1

import { deployContract } from '@1inch/solidity-utils';
import '@nomicfoundation/hardhat-ethers';
import { Signer } from 'ethers';

// Import generated types for all contracts
import { Aqua } from '../../typechain-types/@1inch/aqua/src/Aqua';
import { AquaAMM } from '../../typechain-types/contracts/AquaAMM';
import { AquaSwapVMRouter } from '../../typechain-types/@1inch/swap-vm/src/routers/AquaSwapVMRouter';
import { MockTaker } from '../../typechain-types/contracts/MockTaker';
import { TokenMock } from '../../typechain-types/@1inch/solidity-utils/contracts/mocks/TokenMock';

const { ethers } = require('hardhat');

async function deployFixture() {
  // Get signers
  const [owner, maker, taker, feeReceiver]: Signer[] = await ethers.getSigners();

  // Deploy Aqua
  const aqua = await deployContract("Aqua") as unknown as Aqua;

  console.log("Aqua deployed at:", await aqua.getAddress());
  // Deploy AquaAMM
  const aquaAMM = await deployContract("AquaAMM", [await aqua.getAddress()]) as unknown as AquaAMM;

  console.log("AquaAMM deployed at:", await aquaAMM.getAddress());
  // Deploy AquaSwapVMRouter
  const swapVM = await deployContract("AquaSwapVMRouter", [await aqua.getAddress(), "AquaSwapVM", "1.0.0"]) as unknown as AquaSwapVMRouter;

  console.log("AquaSwapVMRouter deployed at:", await swapVM.getAddress());
  // Deploy MockTaker
  const mockTaker = await deployContract("MockTaker", [await aqua.getAddress(), await swapVM.getAddress(), await owner.getAddress()]) as unknown as MockTaker;

  console.log("MockTaker deployed at:", await mockTaker.getAddress());
  // Deploy mock tokens using TokenMock from solidity-utils
  const token0 = await deployContract("TokenMock", ["Token 0", "TK0"]) as unknown as TokenMock;
  const token1 = await deployContract("TokenMock", ["Token 1", "TK1"]) as unknown as TokenMock;

  return {
    accounts: { owner, maker, taker, feeReceiver },
    tokens: { token0, token1 },
    contracts: { aqua, aquaAMM, swapVM, mockTaker }
  };
}

export { deployFixture };

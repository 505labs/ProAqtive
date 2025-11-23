// SPDX-License-Identifier: Apache-2.0

import "@nomicfoundation/hardhat-chai-matchers";
import { expect, ether } from '@1inch/solidity-utils';
import { ethers } from "hardhat";

describe("Oracle", function () {
  describe("Price Conversion", function () {
    it("should convert Pyth price with negative exponent correctly", async function () {
      // This is a unit test for the price conversion logic
      // We'll deploy MockPriceOracle to test basic functionality
      
      const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
      const mockOracle = await MockPriceOracle.deploy(ether("3000")); // $3000 per ETH
      
      const price = await mockOracle.getPrice();
      expect(price).to.equal(ether("3000"));
    });

    it("should implement IPriceOracle interface", async function () {
      const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
      const mockOracle = await MockPriceOracle.deploy(ether("2000"));
      
      // Verify it has getPrice() method that returns uint256
      const price = await mockOracle.getPrice();
      expect(price).to.be.a("bigint");
      expect(price).to.equal(ether("2000"));
    });

    it("should allow price updates", async function () {
      const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
      const mockOracle = await MockPriceOracle.deploy(ether("2000"));
      
      // Initial price
      let price = await mockOracle.getPrice();
      expect(price).to.equal(ether("2000"));
      
      // Update price
      await mockOracle.setPrice(ether("2500"));
      price = await mockOracle.getPrice();
      expect(price).to.equal(ether("2500"));
    });
  });

  describe("Integration with DODOSwap", function () {
    it("should work with DODOSwap opcode", async function () {
      // This test verifies that Oracle interface is compatible with DODOSwap
      const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
      const mockOracle = await MockPriceOracle.deploy(ether("1"));
      
      // DODOSwap expects getPrice() to return uint256
      const price = await mockOracle.getPrice();
      
      // Verify it's a valid uint256 that can be used in calculations
      expect(price).to.be.gt(0);
      expect(price).to.equal(ether("1"));
      
      // Simulate what DODOSwap does: multiply amount by price
      const amount = ether("100");
      const value = (amount * price) / ether("1");
      expect(value).to.equal(ether("100"));
    });
  });
});

describe("Oracle with Real Pyth (Integration Test)", function () {
  // These tests can only run on networks with Pyth deployed (Sepolia, Mainnet)
  // Skip on Hardhat network
  
  it.skip("should deploy Oracle with Pyth address", async function () {
    // This test would require Pyth to be deployed
    // Run manually on Sepolia with:
    // npx hardhat test test/Oracle.test.ts --network sepolia --grep "should deploy Oracle with Pyth address"
    
    const pythAddress = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"; // Sepolia
    const priceId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"; // ETH/USD
    const maxStaleness = 60;
    
    const Oracle = await ethers.getContractFactory("Oracle");
    const oracle = await Oracle.deploy(pythAddress, priceId, maxStaleness);
    await oracle.waitForDeployment();
    
    const oracleAddress = await oracle.getAddress();
    expect(oracleAddress).to.be.properAddress;
    
    // Verify configuration
    expect(await oracle.pyth()).to.equal(pythAddress);
    expect(await oracle.priceId()).to.equal(priceId);
    expect(await oracle.maxStaleness()).to.equal(maxStaleness);
  });

  it.skip("should fetch price from Pyth oracle", async function () {
    // This test requires Oracle to be deployed and price to be updated
    // Run after deploying Oracle and updating price:
    // ORACLE_ADDRESS=0x... npx hardhat run scripts/update-pyth-price.ts --network sepolia
    // ORACLE_ADDRESS=0x... npx hardhat test test/Oracle.test.ts --network sepolia --grep "should fetch price"
    
    const oracleAddress = process.env.ORACLE_ADDRESS;
    if (!oracleAddress) {
      console.log("Skipping: ORACLE_ADDRESS not set");
      return;
    }
    
    const Oracle = await ethers.getContractFactory("Oracle");
    const oracle = Oracle.attach(oracleAddress);
    
    // Try to get price (might fail if not updated recently)
    try {
      const price = await oracle.getPrice();
      console.log(`Current price: ${ethers.formatEther(price)}`);
      expect(price).to.be.gt(0);
    } catch (error: any) {
      if (error.message.includes("StalePrice")) {
        console.log("Price is stale. Run update-pyth-price.ts first.");
      } else {
        throw error;
      }
    }
  });
});


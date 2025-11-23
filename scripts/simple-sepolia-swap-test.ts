/**
 * SIMPLE Sepolia Swap Test
 * Minimal test to isolate the issue
 */

import { ethers } from "hardhat";
import { MakerTraitsLib, TakerTraitsLib } from "../test/utils/SwapVMHelpers";
import { ProgramBuilder } from "../test/utils/ProgramBuilder";

const ether = ethers.parseEther;

async function main() {
  console.log("🧪 SIMPLE SEPOLIA SWAP TEST\n");
  
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${await deployer.getAddress()}\n`);
  
  // Addresses
  const AQUA = "0x1A2694C890e372b587e8e755eC14E650545aFEca";
  const ROUTER = "0x425eb0ca724A5B6b37A1c4CF9c54A3F1c55E34c1"; // CustomSwapVMRouter
  const METH = "0xC2FB82498d61e136a1d5Dd66Dc5095f4C3aCcbBD";
  const MUSDC = "0xA748Cef1c4E68Cc81448bD061A4aF8FEaD9d5558";
  const PYTH = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21";
  
  const ETH_USD_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  
  // Get contracts
  const router = await ethers.getContractAt("CustomSwapVMRouter", ROUTER);
  const mETH = await ethers.getContractAt("MockToken", METH);
  const mUSDC = await ethers.getContractAt("MockToken", MUSDC);
  const aqua = await ethers.getContractAt("Aqua", AQUA);
  const pyth = await ethers.getContractAt("IPyth", PYTH);
  
  console.log("✅ Contracts loaded\n");
  
  // Check router code size
  const code = await ethers.provider.getCode(ROUTER);
  console.log(`Router code size: ${code.length} bytes`);
  console.log(`Router is CustomSwapVMRouter: ${code.length > 10000}\n`);
  
  // Build a SIMPLE DODO order
  const dodoParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,bytes32,uint256,uint256,uint256,uint256,bool)"],
    [[
      PYTH,                    // pythContract
      ETH_USD_FEED,           // priceFeedId
      60,                     // maxStaleness = 60s
      ether("0.1"),           // k = 0.1
      ether("1"),             // target base = 1 mETH
      ether("2800"),          // target quote = 2800 mUSDC
      true                    // baseIsTokenIn
    ]]
  );
  
  const programBuilder = new ProgramBuilder();
  programBuilder.addInstruction(0x1D, dodoParams); // 0x1D = DODOSwap opcode
  const program = programBuilder.build();
  
  const order = MakerTraitsLib.build({
    maker: await deployer.getAddress(),
    receiver: await deployer.getAddress(),
  }, program);
  
  console.log("✅ Order built\n");
  
  // Try to call swap with minimal setup
  console.log("🔄 Testing swap call...\n");
  
  const takerTraits = TakerTraitsLib.build({
    taker: await deployer.getAddress(),
    isExactIn: true,
    threshold: 0n,
    useTransferFromAndAquaPush: true
  });
  
  try {
    // Just try the call, don't execute
    await router.swap.staticCall(
      order,
      METH,
      MUSDC,
      ether("0.1"),
      takerTraits
    );
    console.log("✅ Static call succeeded!");
  } catch (error: any) {
    console.log("❌ Static call failed:");
    console.log(`   Error: ${error.message}`);
    if (error.data) {
      console.log(`   Data: ${error.data}`);
      console.log(`   Selector: ${error.data.slice(0, 10)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


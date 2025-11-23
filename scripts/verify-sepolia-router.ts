/**
 * Verify the CustomSwapVMRouter on Sepolia
 */

import { ethers } from "hardhat";

const ROUTER = "0x425eb0ca724A5B6b37A1c4CF9c54A3F1c55E34c1";
const AQUA = "0x1A2694C890e372b587e8e755eC14E650545aFEca";

async function main() {
  console.log("🔍 Verifying CustomSwapVMRouter on Sepolia\n");
  
  // Check code
  const code = await ethers.provider.getCode(ROUTER);
  console.log(`Contract code size: ${code.length} bytes`);
  console.log(`Contract exists: ${code !== '0x'}\n`);
  
  if (code === '0x') {
    console.log("❌ No code at this address!");
    return;
  }
  
  // Try to load as CustomSwapVMRouter
  try {
    const router = await ethers.getContractAt("CustomSwapVMRouter", ROUTER);
    console.log("✅ Loaded as CustomSwapVMRouter\n");
    
    // Try to call aqua() - a simple view function that CustomSwapVMRouter should have via SwapVM
    console.log("Testing aqua() view function...");
    try {
      // SwapVM has an aqua() public view function
      const aquaAddress = await (router as any).aqua();
      console.log(`✅ aqua() returned: ${aquaAddress}`);
      console.log(`   Expected: ${AQUA}`);
      console.log(`   Match: ${aquaAddress.toLowerCase() === AQUA.toLowerCase()}\n`);
    } catch (e: any) {
      console.log(`❌ aqua() failed: ${e.message}\n`);
    }
    
    // Check if contract has swap and quote functions
    console.log("Checking function signatures...");
    const swapSig = router.interface.getFunction("swap");
    const quoteSig = router.interface.getFunction("quote");
    
    console.log(`✅ swap signature: ${swapSig?.format()}`);
    console.log(`✅ quote signature: ${quoteSig?.format()}\n`);
    
  } catch (e: any) {
    console.log(`❌ Failed to load contract: ${e.message}\n`);
  }
  
  // Try calling with SwapVM interface
  console.log("Trying SwapVM interface...");
  try {
    const swapVM = await ethers.getContractAt("SwapVM", ROUTER);
    const aquaAddr = await (swapVM as any).aqua();
    console.log(`✅ SwapVM.aqua() = ${aquaAddr}\n`);
  } catch (e: any) {
    console.log(`❌ SwapVM.aqua() failed: ${e.message}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


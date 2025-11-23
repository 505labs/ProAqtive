/**
 * Debug script to test swap function on MyCustomOpcodes
 */

import { ethers } from "hardhat";

const MY_CUSTOM_OPCODES = "0xd3f73AC6D27A7496A7dD1B9D87b2b6723307452b";

async function main() {
  console.log("🔍 Debugging MyCustomOpcodes contract...\n");
  
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${await deployer.getAddress()}\n`);
  
  // Get contract code
  const code = await ethers.provider.getCode(MY_CUSTOM_OPCODES);
  console.log(`Contract code length: ${code.length} bytes`);
  console.log(`Contract exists: ${code !== '0x'}\n`);
  
  // Try different contract interfaces
  console.log("Testing contract interfaces:\n");
  
  // 1. Try as SwapVM
  try {
    const swapVM = await ethers.getContractAt("SwapVM", MY_CUSTOM_OPCODES);
    console.log("✅ Can load as SwapVM");
    
    // Check if swap function exists
    const swapFragment = swapVM.interface.getFunction("swap");
    console.log(`   swap function signature: ${swapFragment?.format()}`);
  } catch (e: any) {
    console.log(`❌ SwapVM interface failed: ${e.message}`);
  }
  
  // 2. Try as AquaSwapVMRouter
  try {
    const router = await ethers.getContractAt("AquaSwapVMRouter", MY_CUSTOM_OPCODES);
    console.log("✅ Can load as AquaSwapVMRouter");
    
    // Check if swap function exists
    const swapFragment = router.interface.getFunction("swap");
    console.log(`   swap function signature: ${swapFragment?.format()}`);
    
    // Check if quote function exists
    const quoteFragment = router.interface.getFunction("quote");
    console.log(`   quote function signature: ${quoteFragment?.format()}`);
  } catch (e: any) {
    console.log(`❌ AquaSwapVMRouter interface failed: ${e.message}`);
  }
  
  // 3. Try as MyCustomOpcodes
  try {
    const custom = await ethers.getContractAt("MyCustomOpcodes", MY_CUSTOM_OPCODES);
    console.log("✅ Can load as MyCustomOpcodes");
    
    // Try to call a view function
    const aquaAddress = await custom.aqua();
    console.log(`   aqua() returns: ${aquaAddress}`);
  } catch (e: any) {
    console.log(`❌ MyCustomOpcodes interface failed: ${e.message}`);
  }
  
  // 4. Get all function selectors
  console.log("\n📋 Checking function selectors on contract:\n");
  
  const iface = new ethers.Interface([
    "function swap((address,uint256,bytes),address,address,uint256,bytes)",
    "function quote((address,uint256,bytes),address,address,uint256,bytes) view returns (uint256,uint256,bytes32)",
    "function aqua() view returns (address)"
  ]);
  
  const swapSelector = iface.getFunction("swap")?.selector;
  const quoteSelector = iface.getFunction("quote")?.selector;
  const aquaSelector = iface.getFunction("aqua")?.selector;
  
  console.log(`swap selector: ${swapSelector}`);
  console.log(`quote selector: ${quoteSelector}`);
  console.log(`aqua selector: ${aquaSelector}`);
  
  // Try calling aqua() to see if contract is working
  try {
    const result = await ethers.provider.call({
      to: MY_CUSTOM_OPCODES,
      data: aquaSelector
    });
    console.log(`\n✅ aqua() call succeeded: ${ethers.AbiCoder.defaultAbiCoder().decode(['address'], result)[0]}`);
  } catch (e: any) {
    console.log(`\n❌ aqua() call failed: ${e.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


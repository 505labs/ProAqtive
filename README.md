# SwapVM Template

A template project for building and deploying custom swap strategies using 1inch's SwapVM and Aqua protocol.


## Overview

This project provides a complete implementation of:
- **AquaAMM**: A concentrated liquidity AMM strategy for SwapVM
- **MockTaker**: A test contract for simulating swap operations
- **Deployment scripts**: Automated deployment and verification
- **Test suite**: Comprehensive tests for swap functionality

### Pre/Post hooks with money market integration on js/hooks branch

## Prerequisites

- Node.js v18+ (Note: Node.js v23 may show warnings but works)
- Yarn
- Git

## Installation

1. Clone the repository:
```bash
git clone https://github.com/1inch/swap-vm-template.git
cd swap-vm-template
```

2. Install dependencies:
```bash
yarn
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file:
```
PRIVATE_KEY=your_private_key_here
SEPOLIA_RPC_URL=your_sepolia_rpc_url
ETHERSCAN_API_KEY=your_etherscan_api_key
```

## Compilation

Compile the smart contracts:
```bash
npx hardhat compile
```

## Testing

Run the test suite:
```bash
npx hardhat test
```

## Deployment

### Local Deployment

Deploy to local Hardhat network:
```bash
yarn deploy hardhat
```

### Testnet Deployment

Deploy to Sepolia testnet:
```bash
yarn deploy sepolia
```

The deployment script will:
1. Deploy Aqua protocol
2. Deploy AquaAMM strategy
3. Deploy AquaSwapVMRouter
4. Deploy MockTaker (optional, for testing)
5. Verify all contracts on Etherscan (for non-local networks)

## Usage Examples

### Creating an AMM Order

```typescript
const order = await aquaAMM.buildProgram(
  makerAddress,        // Liquidity provider
  token0Address,       // First token address
  token1Address,       // Second token address
  feeBpsIn,           // Trading fee in basis points
  delta0,             // Concentration parameter for token0
  delta1,             // Concentration parameter for token1
  decayPeriod,        // Price decay period
  protocolFeeBpsIn,   // Protocol fee in basis points
  feeReceiverAddress, // Fee receiver address
  salt                // Unique order identifier
);
```

### Executing a Swap

```typescript
// Build taker traits
const takerData = TakerTraitsLib.build({
  taker: takerAddress,
  isExactIn: true,
  threshold: minOutputAmount,
  useTransferFromAndAquaPush: true
});

// Execute swap
await swapVM.swap(
  order,
  tokenIn,
  tokenOut,
  amountIn,
  takerData
);
```

## Development

### Project Structure

```
swap-vm-template/
├── contracts/           # Smart contracts
│   ├── AquaAMM.sol     # AMM strategy implementation
│   ├── MockTaker.sol   # Test resolver contract
│   └── SwapVMImport.sol # SwapVM imports
├── deploy/             # Deployment scripts
├── test/               # Test suite
│   ├── AquaAMM.test.ts # Main test file
│   └── utils/          # Test utilities
├── typechain-types/    # Generated TypeScript types
└── hardhat.config.ts   # Hardhat configuration
```

### Building Custom Strategies

To create your own swap strategy:

1. Create a new contract inheriting from SwapVM opcodes
2. Implement your swap logic using the VM instruction set
3. Build program bytecode using the ProgramBuilder
4. Deploy and register with Aqua

### Testing Your Strategy

1. Write unit tests for your strategy logic
2. Test with both resolver contracts and EOAs
3. Verify gas consumption and optimization
4. Test edge cases and error conditions

## Resources


## Disclaimer

This software is provided "as is", without warranty of any kind. Use at your own risk.

## 📄 License

This project is licensed under the **LicenseRef-Degensoft-SwapVM-1.1**

See the [LICENSE](LICENSE) file for details.
See the [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) file for information about third-party software, libraries, and dependencies used in this project.

**Contact for licensing inquiries:**
- 📧 license@degensoft.com 
- 📧 legal@degensoft.com

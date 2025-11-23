#!/bin/bash
export PRIVATE_KEY="08d1c0493ef8f0f52d7ee587f499790ce1fdddc05238b7f203b1239b43586f15"
export SWAP_AMOUNT="0.1"
npx hardhat run scripts/test-aqua-swap.ts --network sepolia


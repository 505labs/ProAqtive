

## TEST

1. Fill in your `.env` file with the required environment variables.

2. Deploy test tokens:
```sh
yarn deploy:test-tokens arbitrumSepolia
```

3. Deploy all contracts (force redeploy):
```sh
FORCE_REDEPLOY=true npx hardhat deploy --tags DeployAll --network arbitrumSepolia
```

4. Ship liquidity to the vault:
```sh
npx hardhat run scripts/ship-liquidity-vault.ts --network arbitrumSepolia
```

5. Update mock oracle price
```sh
npx hardhat run scripts/update-pyth-price.ts --network arbitrumSepolia
```

5. Execute a swap:
```sh
npx hardhat run scripts/execute-swap.ts --network arbitrumSepolia
```
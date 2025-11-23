# Scripts Quick Reference

## Quick Commands

### Check Setup
```bash
npx hardhat run scripts/check-balances.ts --network sepolia
```

### Build Order
```bash
PYTH_ORACLE=0x... PRICE_ID=0x... npx hardhat run scripts/build-order.ts --network sepolia
```

### Ship Liquidity
```bash
TOKEN0=0x... TOKEN1=0x... AMOUNT0=100 AMOUNT1=200 npx hardhat run scripts/ship-liquidity.ts --network sepolia
```

### Get Quote
```bash
TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 npx hardhat run scripts/get-quote.ts --network sepolia
```

### Execute Swap
```bash
TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=10 npx hardhat run scripts/execute-swap.ts --network sepolia
```

### Dock Liquidity
```bash
ORDER_FILE=order.json TOKEN0=0x... TOKEN1=0x... npx hardhat run scripts/dock-liquidity.ts --network sepolia
```


### Full Workflow
```bash
TOKEN0=0x... TOKEN1=0x... PYTH_ORACLE=0x... npx hardhat run scripts/full-workflow-example.ts --network sepolia
```

## Using NPM Scripts

```bash
# Using the npm script helper
yarn script:sepolia scripts/check-balances.ts
yarn script:sepolia scripts/build-order.ts
```

## Common Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TOKEN0`, `TOKEN1` | Token addresses | `0x1234...` |
| `TOKEN_IN`, `TOKEN_OUT` | Swap token addresses | `0x1234...` |
| `AMOUNT0`, `AMOUNT1` | Liquidity amounts | `100`, `200` |
| `AMOUNT_IN` | Swap amount | `10` |
| `PYTH_ORACLE` | Pyth oracle address | `0x1234...` |
| `PRICE_ID` | Price feed ID | `0xabcd...` |
| `K` | k parameter | `500000000000000000` |
| `ORDER_FILE` | Saved order JSON file | `order.json` |
| `THRESHOLD` | Min output amount | `0` |

## Workflow Diagram

```
1. check-balances.ts
   ↓
2. build-order.ts → order.json
   ↓
3. ship-liquidity.ts (uses order.json)
   ↓
4. get-quote.ts (uses order.json)
   ↓
5. execute-swap.ts (uses order.json)
   ↓
6. dock-liquidity.ts (uses order.json) [optional]
   ↓
7. pull-liquidity.ts (uses order.json) [check balances]
```

## Tips

- Save orders to JSON files for reuse
- Check balances before every operation
- Start with small amounts for testing
- Use `get-quote.ts` to preview swaps before executing


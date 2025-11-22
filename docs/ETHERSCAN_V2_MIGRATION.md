# Etherscan API v2 Migration Guide

## What Changed?

Etherscan deprecated their API v1 (network-specific keys) in favor of API v2 (unified key). The migration deadline is **May 31st, 2025**.

## Old Configuration (v1 - Deprecated)

```typescript
etherscan: {
  apiKey: {
    mainnet: process.env.ETHERSCAN_API_KEY || "",
    sepolia: process.env.ETHERSCAN_API_KEY || "",
    // Network-specific keys
  }
}
```

## New Configuration (v2 - Current)

```typescript
etherscan: {
  // Single unified API key for all networks
  apiKey: process.env.ETHERSCAN_API_KEY || "",
}
```

## Migration Steps

### 1. Get Your Etherscan API Key

1. Go to https://etherscan.io/myapikey
2. Create a new API key (or use existing)
3. The same key works for all networks (mainnet, sepolia, etc.)

### 2. Update Your `.env` File

```env
# Single API key for all networks
ETHERSCAN_API_KEY=your_api_key_here
```

### 3. Update `hardhat.config.ts`

Change from:
```typescript
etherscan: {
  apiKey: {
    mainnet: "...",
    sepolia: "...",
  }
}
```

To:
```typescript
etherscan: {
  apiKey: process.env.ETHERSCAN_API_KEY || "",
}
```

### 4. Test Verification

```bash
# Verify a contract
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

## Benefits of v2

- ✅ **Single API key** for all networks
- ✅ **Simpler configuration**
- ✅ **Unified multichain experience**
- ✅ **Future-proof** (v1 will stop working May 31, 2025)

## Troubleshooting

### "Invalid API Key"

- Make sure your API key is correct
- Check that it's set in `.env` file
- Verify the key at https://etherscan.io/myapikey

### "Rate limit exceeded"

- Free tier has rate limits
- Wait a few minutes and try again
- Consider upgrading your Etherscan plan

### Still getting v1 warnings?

- Make sure you're using the latest `@nomicfoundation/hardhat-verify` package
- Clear `node_modules` and reinstall: `rm -rf node_modules && yarn install`

## More Information

- [Etherscan API v2 Migration Guide](https://docs.etherscan.io/v2-migration)
- [Hardhat Verify Plugin](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify)


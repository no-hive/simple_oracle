# Simple Oracle

[![Tests](https://github.com/no-hive/simple_oracle/actions/workflows/tests.yml/badge.svg?branch=main&event=push)](https://github.com/no-hive/simple_oracle/actions/workflows/tests.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fno-hive%2Fsimple_oracle%2Fgh-pages%2Fcoverage.json&style=flat&cacheSeconds=300)](https://github.com/no-hive/simple_oracle/actions/workflows/coverage.yml)

A simple onchain price oracle with fixed asset IDs, batch reads, and a trusted updater.

## How it works

- Asset IDs and names are permanently assigned at deployment.
- The owner appoints an updater who submits all prices in order.
- Each update stores the price and block number.
- Anyone can read prices. Batch results follow the requested order.

Prices are integers with no built-in decimal scale. Before the first update, values are zero.

## Integration

Pass the deployed oracle address to your contract’s constructor.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Batch read interface for Simple Oracle.
interface ISimpleOracle {
    /// @notice Returns prices in the requested order.
    /// @param assetIds The asset IDs to read.
    /// @return prices The corresponding prices.
    function getPrices(uint256[] calldata assetIds)
        external view returns (uint256[] memory prices);
}

/// @notice Example oracle integration.
contract MyApp {
    /// @notice The oracle used by this application.
    ISimpleOracle public immutable oracle;

    /// @param oracleAddress The deployed oracle address.
    constructor(address oracleAddress) {
        oracle = ISimpleOracle(oracleAddress);
    }

    /// @notice Reads the requested asset prices.
    /// @param assetIds The asset IDs in any order.
    /// @return prices The corresponding prices.
    function readPrices(uint256[] calldata assetIds)
        external view returns (uint256[] memory prices)
    {
        return oracle.getPrices(assetIds);
    }
}
```

`readPrices([2, 0, 2])` returns `[price2, price0, price2]`. Unknown IDs revert.

Use `assetData(id)` on the oracle to read a price and its update block, or `assetNames(id)` to read its name.

## Demo contract

`SimpleOracleConsumer` saves prices and compares them later:

1. Deploy with `(oracleAddress, assetIds, delaySeconds)`.
2. Anyone calls `savePrices()` once to store the initial prices.
3. After the delay, anyone sends a `checkPrices()` transaction.

Results follow the asset order: `1` means higher, `0` means lower. If any price is unchanged, the entire comparison reverts.

Results are stored in `lastResults(index)` and emitted in `PricesCompared`. Repeated comparisons always use the original snapshot.

## Tests

```bash
npm ci
npm test
npm run coverage
```

Tests run entirely on a local Hardhat EVM, without network forks or external RPCs.

GitHub Actions runs tests and coverage checks automatically. Coverage must remain at least 90% for lines, branches, functions, and statements in each contract. The coverage badge updates after successful runs on `main`.

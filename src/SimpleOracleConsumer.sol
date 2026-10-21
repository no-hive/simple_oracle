// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Simple Oracle Read Interface
/// @notice Exposes batch price reads from Simple Oracle.
interface ISimpleOracle {
    /// @notice Returns prices in the same order as the requested asset IDs.
    /// @param assetIds The asset IDs to read.
    /// @return prices The corresponding prices.
    function getPrices(
        uint256[] calldata assetIds
    ) external view returns (uint256[] memory prices);
}

/// @title Simple Oracle Consumer
/// @notice Saves initial oracle prices and compares them with later prices.
/// @dev Anyone may save the initial snapshot once and submit later comparisons.
contract SimpleOracleConsumer {
    /// @notice The oracle used to read asset prices.
    ISimpleOracle public immutable oracle;

    /// @notice The asset IDs in the order used for snapshots and comparisons.
    uint256[] public assetIds;

    /// @notice The initial prices, indexed in the same order as assetIds.
    uint256[] public savedPrices;

    /// @notice The timestamp at which the initial prices were saved.
    uint256 public savedAt;

    /// @notice The block number at which the initial prices were saved.
    /// @dev This is the snapshot block, not the oracle's last update block.
    uint256 public savedAtBlock;

    /// @notice The minimum number of seconds before comparisons are available.
    uint256 public immutable comparisonDelay;

    /// @notice Whether the initial prices have already been saved.
    bool public initialized;

    /// @notice The results of the latest successful comparison, in assetIds order.
    /// @dev Empty until the first successful comparison.
    uint256[] public lastResults;

    /// @notice Emitted when the initial prices are permanently saved.
    /// @param caller The address that saved the prices.
    /// @param prices The saved prices in assetIds order.
    event PricesSaved(address indexed caller, uint256[] prices);

    /// @notice Emitted for each successful comparison transaction.
    /// @param caller The address that submitted the comparison.
    /// @param currentPrices The oracle prices used in the comparison.
    /// @param results One for a higher price and zero for a lower price.
    event PricesCompared(
        address indexed caller,
        uint256[] currentPrices,
        uint256[] results
    );

    /// @notice Configures the oracle, asset IDs and waiting period.
    /// @dev Does not save prices. Anyone may call savePrices after deployment.
    /// @param oracleAddress The deployed Simple Oracle address.
    /// @param requestedAssetIds The asset IDs to save, in the desired order.
    /// @param delaySeconds The waiting period before anyone can compare prices.
    constructor(
        address oracleAddress,
        uint256[] memory requestedAssetIds,
        uint256 delaySeconds
    ) {
        oracle = ISimpleOracle(oracleAddress);
        assetIds = requestedAssetIds;
        comparisonDelay = delaySeconds;
    }

    /// @notice Reads and permanently saves the initial oracle prices.
    /// @dev Anyone may call this function, but it can succeed only once.
    ///      The waiting period starts when this transaction is executed.
    function savePrices() external {
        require(!initialized, "Already initialized");

        savedPrices = oracle.getPrices(assetIds);
        savedAt = block.timestamp;
        savedAtBlock = block.number;
        initialized = true;

        emit PricesSaved(msg.sender, savedPrices);
    }

    /// @notice Compares current prices with the initial snapshot.
    /// @dev Anyone may call this function after the waiting period.
    ///      Comparisons never replace the initial snapshot.
    ///      Saves the results and emits an event without replacing the snapshot.
    ///      Reverts the entire comparison if any price is unchanged.
    /// @return results One for each higher price and zero for each lower price,
    ///         in the same order as assetIds.
    function checkPrices() external returns (uint256[] memory results) {
        require(initialized, "Not initialized");
        require(block.timestamp - savedAt >= comparisonDelay, "Too early");

        uint256[] memory currentPrices = oracle.getPrices(assetIds);
        results = new uint256[](assetIds.length);

        for (uint256 i = 0; i < assetIds.length; i++) {
            require(currentPrices[i] != savedPrices[i], "Price unchanged");
            results[i] = currentPrices[i] > savedPrices[i] ? 1 : 0;
        }

        lastResults = results;
        emit PricesCompared(msg.sender, currentPrices, results);
    }
}

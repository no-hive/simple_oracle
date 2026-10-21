// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Simple Oracle
/// @notice Stores prices and update block numbers for a fixed set of assets.
/// @dev Asset IDs and names are assigned during deployment and cannot be changed.
contract SimpleOracle {
    /// @notice Contains an asset's latest price and update block number.
    struct AssetData {
        /// @notice The latest price submitted by the trusted updater.
        uint256 price;
        /// @notice The block number of the latest price update.
        uint256 lastUpdatedBlock;
    }

    /// @notice The contract owner authorized to change the trusted updater.
    address public immutable owner;

    /// @notice The address authorized to update all asset prices.
    address public trustedUpdater;

    /// @notice The fixed number of assets registered during deployment.
    uint256 public immutable assetCount;

    /// @notice Maps each asset ID to its permanently assigned name.
    mapping(uint256 => string) public assetNames;

    /// @notice Maps each asset ID to its latest price and update block number.
    /// @dev Both fields remain zero until the first price update.
    mapping(uint256 => AssetData) public assetData;

    /// @notice Registers asset names and sets the initial trusted updater.
    /// @dev Asset IDs range from zero to names.length minus one,
    ///      following the order of the supplied names.
    /// @param names The asset names in their permanent order.
    /// @param initialTrustedUpdater The address initially authorized to update prices.
    constructor(
        string[] memory names,
        address initialTrustedUpdater
    ) {
        owner = msg.sender;
        trustedUpdater = initialTrustedUpdater;
        assetCount = names.length;

        for (uint256 i = 0; i < names.length; i++) {
            assetNames[i] = names[i];
        }
    }

    /// @notice Sets the address authorized to update prices.
    /// @dev Only the contract owner may call this function.
    /// @param updater The new trusted updater address.
    function setTrustedUpdater(address updater) external {
        require(msg.sender == owner, "Only owner");

        trustedUpdater = updater;
    }

    /// @notice Returns prices for the requested asset IDs in the supplied order.
    /// @dev Reverts if any asset ID is not registered. Duplicate IDs are allowed.
    ///      An empty request returns an empty array.
    /// @param assetIds The asset IDs to read, in any order.
    /// @return prices The prices, with prices[i] corresponding to assetIds[i].
    function getPrices(
        uint256[] calldata assetIds
    ) external view returns (uint256[] memory prices) {
        prices = new uint256[](assetIds.length);

        for (uint256 i = 0; i < assetIds.length; i++) {
            require(assetIds[i] < assetCount, "Unknown asset");

            prices[i] = assetData[assetIds[i]].price;
        }
    }

    /// @notice Updates every asset's price and records the current block number.
    /// @dev Only the trusted updater may call this function.
    ///      Both arrays must contain exactly assetCount elements.
    ///      Asset IDs must appear in ascending order, starting from zero.
    ///      Any failed check reverts the entire update.
    /// @param assetIds All registered asset IDs in their permanent order.
    /// @param prices The prices corresponding to the supplied asset IDs.
    function updatePrices(
        uint256[] calldata assetIds,
        uint256[] calldata prices
    ) external {
        require(msg.sender == trustedUpdater, "Only trusted updater");
        require(assetIds.length == assetCount, "Wrong asset count");
        require(prices.length == assetCount, "Wrong price count");

        for (uint256 i = 0; i < assetCount; i++) {
            require(assetIds[i] == i, "Wrong asset order");

            assetData[i] = AssetData({
                price: prices[i],
                lastUpdatedBlock: block.number
            });
        }
    }
}

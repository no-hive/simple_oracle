# Simple Oracle

[![Tests](https://github.com/no-hive/simple_oracle/actions/workflows/tests.yml/badge.svg?branch=main&event=push)](https://github.com/no-hive/simple_oracle/actions/workflows/tests.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fno-hive%2Fsimple_oracle%2Fgh-pages%2Fcoverage.json&style=flat&cacheSeconds=300)](https://github.com/no-hive/simple_oracle/actions/workflows/coverage.yml)

Simple Oracle — тестовый onchain-оракл: хранит цены фиксированного набора ассетов и блок последнего обновления. Приложения могут читать одну или несколько цен за один вызов.

## Как работает

- Номера ассетов (`0`, `1`, `2`, …) и названия задаются в конструкторе и больше не меняются.
- Владелец назначает доверенный адрес. Этот адрес вызывает `updatePrices(assetIds, prices)`, передавая все ассеты строго по порядку.
- `getPrices(assetIds)` возвращает цены в порядке запроса: `[2, 0, 1]` → `[цена №2, цена №0, цена №1]`.
- `assetData(id)` возвращает цену и блок обновления, `assetNames(id)` — название, `assetCount()` — количество ассетов.

Цены — целые числа. Масштаб значений согласуется с поставщиком данных: встроенного `decimals` нет. До первого обновления цена и блок равны нулю. `getPrices` отклоняет неизвестные номера ассетов.

## Интеграция в свой контракт

Скопируйте интерфейс и используйте его в своём контракте. В конструктор передайте адрес развёрнутого `SimpleOracle` в той же сети.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Read interface for Simple Oracle.
interface ISimpleOracleReader {
    /// @notice Returns prices in the requested asset order.
    /// @param assetIds The asset IDs to read.
    /// @return prices The corresponding prices.
    function getPrices(uint256[] calldata assetIds)
        external view returns (uint256[] memory prices);

    /// @notice Returns the stored data for one asset.
    /// @param assetId The asset ID to read.
    /// @return price The stored price.
    /// @return lastUpdatedBlock The block of the latest update.
    function assetData(uint256 assetId)
        external view returns (uint256 price, uint256 lastUpdatedBlock);
}

/// @notice Example integration with Simple Oracle.
contract MyApp {
    /// @notice The oracle used by this application.
    ISimpleOracleReader public immutable oracle;

    /// @param oracleAddress The deployed Simple Oracle address.
    constructor(address oracleAddress) {
        oracle = ISimpleOracleReader(oracleAddress);
    }

    /// @notice Reads any selection of asset prices in the supplied order.
    /// @param assetIds The asset IDs to read.
    /// @return prices The corresponding prices.
    function readPrices(uint256[] calldata assetIds)
        external view returns (uint256[] memory prices)
    {
        return oracle.getPrices(assetIds);
    }

    /// @notice Reads one asset's price and update block.
    /// @param assetId The registered asset ID to read.
    /// @return price The stored price.
    /// @return lastUpdatedBlock The block of the latest update.
    function readAsset(uint256 assetId)
        external view returns (uint256 price, uint256 lastUpdatedBlock)
    {
        return oracle.assetData(assetId);
    }
}
```

Например, `readPrices([1])` вернёт одну цену, а `readPrices([2, 0, 2])` — три цены, включая повтор. Эти значения можно использовать в своей Solidity-логике через `oracle.getPrices(ids)`. Публичные функции также доступны через RPC и эксплореры; для чтения вне цепи отправлять транзакцию не нужно.

## Проверка через второй контракт

`SimpleOracleConsumer` показывает, как другой контракт сохраняет цены у себя и затем использует их в транзакциях. Все его действия доступны любому адресу.

1. Заполните цены оракла и разверните consumer: `SimpleOracleConsumer(oracleAddress, [0, 1], 60)`. Последний аргумент — ожидание в секундах.
2. Отправьте транзакцию `savePrices()`. Она один раз сохранит исходные цены. Повторная запись невозможна для всех адресов.
3. Обновите цены в оракле. После 60 секунд с момента сохранения любой адрес может отправить транзакцию `checkPrices()`.
4. Смотрите результат в событии `PricesCompared` этой транзакции или через `lastResults(index)`: `1` — цена выше исходной, `0` — ниже. Порядок соответствует списку ассетов.

Например: сохранены `[100, 200]`, текущие цены `[110, 190]` → результат `[1, 0]`. Если хотя бы одна цена не изменилась, сравнение целиком отклоняется с `Price unchanged`.

`checkPrices()` — записывающая функция, а не `view`: она сохраняет результаты и выпускает событие. Её можно вызывать повторно с любых адресов; исходные цены остаются прежними. `savedPrices(index)` позволяет проверить сохранённый снимок.

## Тесты и покрытие

Нужен Node.js 22 или 24; GitHub Actions использует Node.js 24.

```bash
npm ci
npm test
npm run coverage
```

Тесты и измерение покрытия выполняются только в локальной Hardhat EVM: без форков, внешних RPC, кошельков и средств. Solidity-компилятор поставляется с npm-зависимостями. `npm run compile` компилирует контракты отдельно.

`npm run coverage` измеряет покрытие Solidity обоих контрактов. Минимум — 90% строк, ветвлений, функций и инструкций отдельно для каждого контракта и суммарно. Ниже порога команда завершается ошибкой. HTML-отчёт: `coverage/index.html`, данные для бейджа: `coverage/coverage.json`.

## Загрузка на GitHub и бейджи

Загрузите **содержимое папки** в корень `no-hive/simple_oracle`, включая `.github/workflows/`, `.gitignore` и `.solcover.js`. Основная ветка — `main`.

После push автоматически запускаются `tests.yml` и `coverage.yml`; они также работают на pull request. Бейдж Tests показывает состояние тестов в `main`. После успешной проверки покрытия в основной ветке workflow создаёт или обновляет ветку `gh-pages`, а Coverage показывает процент покрытых строк обоих Solidity-контрактов. Pull request не меняет публичный бейдж покрытия.

Ссылки бейджей уже добавлены в начало этого README. До первого успешного запуска данные покрытия могут быть недоступны. Если проверка покрытия упала, бейдж сохраняет последний успешно опубликованный процент; ошибка видна в Actions. Обновление изображения может задерживаться из-за кеша.

Дополнительные сервисы и секреты не нужны: используется стандартный `GITHUB_TOKEN`. GitHub Actions должен быть включён, а политика репозитория должна разрешать `contents: write` для публикации в `gh-pages`. Включать GitHub Pages для работы бейджа не требуется. Полный отчёт доступен в артефакте `solidity-coverage` соответствующего запуска Actions.

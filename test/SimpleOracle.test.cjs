const { it: test, afterEach } = require('mocha');
const assert = require('node:assert/strict');
const hre = require('hardhat');
const { BrowserProvider, ContractFactory } = require('ethers');
let activeProvider;
let cleanStateSnapshot;

afterEach(() => {
  if (activeProvider) activeProvider.destroy();
  activeProvider = undefined;
});

async function fixture() {
  const rpc = hre.network.provider;
  if (cleanStateSnapshot !== undefined) {
    assert.equal(await rpc.request({ method: 'evm_revert', params: [cleanStateSnapshot] }), true);
  }
  cleanStateSnapshot = await rpc.request({ method: 'evm_snapshot', params: [] });
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  activeProvider = provider;
  const [owner, updater, visitor, replacement] = await Promise.all(
    [0, 1, 2, 3].map(index => provider.getSigner(index))
  );

  async function deploy(name, args, signer = owner) {
    const artifact = hre.artifacts.readArtifactSync(name);
    const contract = await new ContractFactory(
      artifact.abi, artifact.bytecode, signer
    ).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  }

  const oracle = await deploy('SimpleOracle', [
    ['ETH/USD', 'BTC/USD', 'LINK/USD'], await updater.getAddress()
  ]);

  async function update(prices = [100, 150, 200]) {
    return (await oracle.connect(updater).updatePrices([0, 1, 2], prices)).wait();
  }

  async function consumer(ids = [2, 0, 1], delay = 60) {
    return deploy('SimpleOracleConsumer', [await oracle.getAddress(), ids, delay]);
  }

  async function at(timestamp) {
    await rpc.request({ method: 'evm_setNextBlockTimestamp', params: [Number(timestamp)] });
    await rpc.request({ method: 'evm_mine', params: [] });
    const block = await rpc.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    assert.equal(BigInt(block.timestamp), BigInt(timestamp));
  }

  return { oracle, owner, updater, visitor, replacement, update, consumer, at };
}

test('deployment exposes owner, updater, asset count, names and initial data', async () => {
  const { oracle, owner, updater } = await fixture();
  assert.equal(await oracle.owner(), await owner.getAddress());
  assert.equal(await oracle.trustedUpdater(), await updater.getAddress());
  assert.equal(await oracle.assetCount(), 3n);
  assert.equal(await oracle.assetNames(0), 'ETH/USD');
  assert.equal(await oracle.assetNames(1), 'BTC/USD');
  assert.equal(await oracle.assetNames(2), 'LINK/USD');
  assert.deepEqual(Array.from(await oracle.assetData(0)), [0n, 0n]);
});

test('trusted updater updates all prices and records the transaction block', async () => {
  const { oracle, update } = await fixture();
  const receipt = await update();
  for (const [id, price] of [100n, 150n, 200n].entries()) {
    assert.deepEqual(Array.from(await oracle.assetData(id)), [price, BigInt(receipt.blockNumber)]);
  }
  const next = await update([110, 160, 210]);
  assert(next.blockNumber > receipt.blockNumber);
  assert.deepEqual(Array.from(await oracle.assetData(0)), [110n, BigInt(next.blockNumber)]);
  assert.equal(await oracle.assetNames(0), 'ETH/USD');
});

test('an unauthorized caller cannot update prices', async () => {
  const { oracle, visitor } = await fixture();
  await assert.rejects(oracle.connect(visitor).updatePrices.staticCall([0, 1, 2], [1, 2, 3]), /Only trusted updater/);
  assert.deepEqual(Array.from(await oracle.getPrices([0, 1, 2])), [0n, 0n, 0n]);
});

test('only the owner can change the updater', async () => {
  const { oracle, visitor, replacement } = await fixture();
  await assert.rejects(oracle.connect(visitor).setTrustedUpdater.staticCall(await replacement.getAddress()), /Only owner/);
});

test('updater rotation revokes the old updater and enables the new one', async () => {
  const { oracle, updater, replacement } = await fixture();
  await (await oracle.setTrustedUpdater(await replacement.getAddress())).wait();
  assert.equal(await oracle.trustedUpdater(), await replacement.getAddress());
  await assert.rejects(oracle.connect(updater).updatePrices.staticCall([0, 1, 2], [1, 2, 3]), /Only trusted updater/);
  await (await oracle.connect(replacement).updatePrices([0, 1, 2], [1, 2, 3])).wait();
  assert.deepEqual(Array.from(await oracle.getPrices([0, 1, 2])), [1n, 2n, 3n]);
});

test('updates reject incomplete and oversized asset lists', async () => {
  const { oracle, updater } = await fixture();
  for (const ids of [[0, 1], [0, 1, 2, 3]]) {
    await assert.rejects(oracle.connect(updater).updatePrices.staticCall(ids, [1, 2, 3]), /Wrong asset count/);
  }
});

test('updates reject incomplete and oversized price lists', async () => {
  const { oracle, updater } = await fixture();
  for (const prices of [[1, 2], [1, 2, 3, 4]]) {
    await assert.rejects(oracle.connect(updater).updatePrices.staticCall([0, 1, 2], prices), /Wrong price count/);
  }
});

test('updates reject reordered, duplicate and unknown asset IDs', async () => {
  const { oracle, updater } = await fixture();
  for (const ids of [[1, 0, 2], [0, 0, 2], [0, 1, 99]]) {
    await assert.rejects(oracle.connect(updater).updatePrices.staticCall(ids, [1, 2, 3]), /Wrong asset order/);
  }
});

test('a failed transaction reverts partial writes to earlier assets', async () => {
  const { oracle, updater, update } = await fixture();
  await update();
  const before = Array.from(await oracle.assetData(0));
  await assert.rejects(async () => {
    const tx = await oracle.connect(updater).updatePrices([0, 1, 99], [999, 888, 777], { gasLimit: 500000 });
    await tx.wait();
  });
  assert.deepEqual(Array.from(await oracle.assetData(0)), before);
  assert.deepEqual(Array.from(await oracle.getPrices([0, 1, 2])), [100n, 150n, 200n]);
});

test('batch reads preserve arbitrary input order and duplicate IDs', async () => {
  const { oracle, update } = await fixture();
  await update();
  assert.deepEqual(Array.from(await oracle.getPrices([2, 0, 2, 1])), [200n, 100n, 200n, 150n]);
});

test('batch reads support one asset and an empty request', async () => {
  const { oracle, update } = await fixture();
  await update();
  assert.deepEqual(Array.from(await oracle.getPrices([1])), [150n]);
  assert.deepEqual(Array.from(await oracle.getPrices([])), []);
});

test('batch reads reject an unknown asset instead of returning a zero price', async () => {
  const { oracle } = await fixture();
  await assert.rejects(oracle.getPrices([0, 3]), /Unknown asset/);
});

function eventFrom(app, receipt, name) {
  return receipt.logs.map(log => {
    try { return app.interface.parseLog(log); } catch { return null; }
  }).find(event => event && event.name === name);
}

async function compare(app, signer) {
  const receipt = await (await app.connect(signer).checkPrices()).wait();
  assert.equal(receipt.status, 1);
  const event = eventFrom(app, receipt, 'PricesCompared');
  assert(event);
  assert.equal(event.args.caller, await signer.getAddress());
  const results = Array.from(event.args.results);
  for (let i = 0; i < results.length; i++) {
    assert.equal(await app.lastResults(i), results[i]);
  }
  return { receipt, results, currentPrices: Array.from(event.args.currentPrices) };
}

test('consumer deployment configures assets without saving a snapshot', async () => {
  const { oracle, consumer } = await fixture();
  const app = await consumer();
  assert.equal(await app.oracle(), await oracle.getAddress());
  assert.equal(await app.comparisonDelay(), 60n);
  assert.equal(await app.initialized(), false);
  assert.equal(await app.savedAt(), 0n);
  assert.equal(await app.savedAtBlock(), 0n);
  for (const [index, id] of [2n, 0n, 1n].entries()) {
    assert.equal(await app.assetIds(index), id);
  }
  await assert.rejects(app.savedPrices(0));
});

test('any address can save the initial prices once in a separate transaction', async () => {
  const { update, consumer, visitor } = await fixture();
  const app = await consumer();
  await update();
  const receipt = await (await app.connect(visitor).savePrices()).wait();
  assert.equal(await app.initialized(), true);
  for (const [index, value] of [200n, 100n, 150n].entries()) {
    assert.equal(await app.savedPrices(index), value);
  }
  assert.equal(await app.savedAtBlock(), BigInt(receipt.blockNumber));
  assert.equal(await app.savedAt(), BigInt((await receipt.getBlock()).timestamp));
  const event = eventFrom(app, receipt, 'PricesSaved');
  assert.equal(event.args.caller, await visitor.getAddress());
  assert.deepEqual(Array.from(event.args.prices), [200n, 100n, 150n]);
});

test('no address can overwrite a saved snapshot', async () => {
  const { update, consumer, owner, visitor, replacement } = await fixture();
  await update();
  const app = await consumer();
  await (await app.connect(visitor).savePrices()).wait();
  const savedAt = await app.savedAt();
  const savedBlock = await app.savedAtBlock();
  await update([900, 900, 900]);
  for (const signer of [visitor, owner, replacement]) {
    await assert.rejects(app.connect(signer).savePrices.staticCall(), /Already initialized/);
  }
  await assert.rejects(async () => {
    const tx = await app.connect(owner).savePrices({ gasLimit: 500000 });
    await tx.wait();
  });
  assert.equal(await app.savedPrices(0), 200n);
  assert.equal(await app.savedAt(), savedAt);
  assert.equal(await app.savedAtBlock(), savedBlock);
});

test('consumer rejects comparisons until the initial snapshot is saved', async () => {
  const { consumer, visitor } = await fixture();
  const app = await consumer([0], 0);
  await assert.rejects(app.connect(visitor).checkPrices.staticCall(), /Not initialized/);
});

test('consumer rejects comparisons before the waiting period ends', async () => {
  const { update, consumer, at, visitor } = await fixture();
  await update();
  const app = await consumer();
  await (await app.connect(visitor).savePrices()).wait();
  await update([101, 151, 201]);
  await at((await app.savedAt()) + 59n);
  await assert.rejects(app.checkPrices.staticCall(), /Too early/);
});

test('comparison is allowed exactly at the waiting period boundary', async () => {
  const { update, consumer, at, visitor } = await fixture();
  await update();
  const app = await consumer();
  await (await app.connect(visitor).savePrices()).wait();
  await update([101, 151, 201]);
  await at((await app.savedAt()) + 60n);
  assert.deepEqual(Array.from(await app.checkPrices.staticCall()), [1n, 1n, 1n]);
  assert.deepEqual((await compare(app, visitor)).results, [1n, 1n, 1n]);
});

test('different addresses submit real comparison transactions and ordered results', async () => {
  const { update, consumer, at, visitor, replacement } = await fixture();
  await update();
  const app = await consumer();
  await (await app.connect(visitor).savePrices()).wait();
  await update([99, 149, 201]);
  await at((await app.savedAt()) + 60n);
  const first = await compare(app, replacement);
  assert.deepEqual(first.results, [1n, 0n, 0n]);
  assert.deepEqual(first.currentPrices, [201n, 99n, 149n]);
  await update([101, 151, 199]);
  const second = await compare(app, visitor);
  assert.deepEqual(second.results, [0n, 1n, 1n]);
});

test('repeated comparison transactions never replace the initial snapshot', async () => {
  const { update, consumer, visitor, replacement } = await fixture();
  await update();
  const app = await consumer([0], 0);
  await (await app.connect(visitor).savePrices()).wait();
  const savedAt = await app.savedAt();
  const savedBlock = await app.savedAtBlock();
  for (const [price, expected] of [[110, 1n], [90, 0n], [105, 1n]]) {
    await update([price, 150, 200]);
    assert.deepEqual((await compare(app, replacement)).results, [expected]);
  }
  assert.equal(await app.savedPrices(0), 100n);
  assert.equal(await app.savedAt(), savedAt);
  assert.equal(await app.savedAtBlock(), savedBlock);
});

test('an equal price reverts the whole transaction and preserves earlier results', async () => {
  const { update, consumer, visitor } = await fixture();
  await update();
  const app = await consumer([0, 1], 0);
  await (await app.connect(visitor).savePrices()).wait();
  await update([110, 140, 200]);
  assert.deepEqual((await compare(app, visitor)).results, [1n, 0n]);
  await update([90, 150, 200]);
  await assert.rejects(app.checkPrices.staticCall(), /Price unchanged/);
  await assert.rejects(async () => {
    const tx = await app.connect(visitor).checkPrices({ gasLimit: 500000 });
    await tx.wait();
  });
  assert.equal(await app.lastResults(0), 1n);
  assert.equal(await app.lastResults(1), 0n);
  assert.equal(await app.savedPrices(0), 100n);
});

test('consumer preserves duplicate asset IDs and accepts zero waiting time', async () => {
  const { update, consumer, visitor } = await fixture();
  await update();
  const app = await consumer([1, 0, 1], 0);
  await (await app.connect(visitor).savePrices()).wait();
  await update([90, 160, 200]);
  assert.deepEqual((await compare(app, visitor)).results, [1n, 0n, 1n]);
});

test('an unknown asset rejects initialization without consuming the one-time save', async () => {
  const { consumer } = await fixture();
  const app = await consumer([3], 0);
  await assert.rejects(app.savePrices.staticCall(), /Unknown asset/);
  assert.equal(await app.initialized(), false);
  assert.equal(await app.savedAt(), 0n);
});

test('consumer supports an empty snapshot and an empty comparison result', async () => {
  const { consumer, visitor } = await fixture();
  const app = await consumer([], 0);
  await (await app.connect(visitor).savePrices()).wait();
  assert.equal(await app.initialized(), true);
  assert.deepEqual((await compare(app, visitor)).results, []);
});

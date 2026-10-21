require('solidity-coverage');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Use the pinned npm compiler without downloading a compiler at test time.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion !== '0.8.20') return runSuper();
  return {
    compilerPath: require.resolve('solc/soljson.js'),
                                                        isSolcJs: true,
                                                        version: solcVersion,
                                                        longVersion: require('solc').version()
  };
});

module.exports = {
  paths: {
    sources: './src'
  },
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai'
    }
  },
  networks: {
    hardhat: { hardfork: 'shanghai' }
  },
  mocha: { timeout: 30000 }
};

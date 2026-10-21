const fs = require('node:fs');
const path = require('node:path');
const { createCoverageMap } = require('istanbul-lib-coverage');

const map = createCoverageMap(JSON.parse(fs.readFileSync('coverage.json', 'utf8')));
for (const contract of ['SimpleOracle.sol', 'SimpleOracleConsumer.sol']) {
  if (!map.files().some(file => path.basename(file) === contract)) {
    throw new Error(`Missing coverage for ${contract}`);
  }
}

const total = map.getCoverageSummary().toJSON();
fs.mkdirSync('coverage', { recursive: true });
fs.writeFileSync('coverage/summary.json', JSON.stringify(total, null, 2) + '\n');

const thresholds = { lines: 90, statements: 90, functions: 90, branches: 90 };
let failed = false;
for (const [file, summary] of [
  ['All contracts', total],
  ...map.files().map(file => [path.basename(file), map.fileCoverageFor(file).toSummary().toJSON()])
]) {
  for (const [metric, minimum] of Object.entries(thresholds)) {
    const value = summary[metric].pct;
    console.log(`${file}: ${metric} ${value}% (minimum ${minimum}%)`);
    if (typeof value !== 'number' || value < minimum) failed = true;
  }
}

const pct = total.lines.pct;
fs.writeFileSync('coverage/coverage.json', JSON.stringify({
  schemaVersion: 1,
  label: 'coverage',
  message: `${pct}%`,
  color: pct >= 90 ? '32CB55' : pct >= 75 ? 'yellow' : 'red'
}, null, 2) + '\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Solidity coverage\n\n| Metric | Coverage | Minimum |\n| --- | --- | --- |\n' +
    Object.entries(thresholds).map(([metric, minimum]) =>
      `| ${metric} | ${total[metric].pct}% | ${minimum}% |\n`
    ).join('') + '\n');
}

if (failed) {
  console.error('Solidity coverage is below the required threshold.');
  process.exitCode = 1;
}

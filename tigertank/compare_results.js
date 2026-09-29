// compare_results.js — Summarize results from results/runs.csv
// Usage: node compare_results.js

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, 'results', 'runs.csv');

if (!fs.existsSync(CSV_PATH)) {
  console.log(`No results file found at ${CSV_PATH}`);
  console.log('Run `npm run run:all` first to generate results.');
  process.exit(1);
}

const content = fs.readFileSync(CSV_PATH, 'utf8');
const lines = content.trim().split('\n');
const header = lines[0].split(',');
const rows = lines.slice(1).map(line => {
  const cols = line.split(',');
  const row = {};
  header.forEach((h, i) => row[h] = cols[i]);
  return row;
});

console.log('=== RESULTS SUMMARY ===\n');

// Group by version
const byVersion = {};
for (const row of rows) {
  if (!byVersion[row.version]) byVersion[row.version] = [];
  byVersion[row.version].push(row);
}

// Print table
console.log('Version | Runs | Avg Kills | Avg Deaths | Avg Died@Tick | Best Kills | Worst Kills');
console.log('--------|------|-----------|------------|---------------|------------|------------');

const summary = [];
for (const version of Object.keys(byVersion).sort()) {
  const runs = byVersion[version];
  const kills = runs.map(r => parseInt(r.kills));
  const deaths = runs.map(r => parseInt(r.deaths));
  const diedAt = runs.map(r => r.died_at_tick).filter(t => t).map(t => parseInt(t));

  const avgKills = (kills.reduce((a, b) => a + b, 0) / kills.length).toFixed(1);
  const avgDeaths = (deaths.reduce((a, b) => a + b, 0) / deaths.length).toFixed(1);
  const avgDiedAt = diedAt.length > 0 ? (diedAt.reduce((a, b) => a + b, 0) / diedAt.length).toFixed(0) : 'N/A';
  const bestKills = Math.max(...kills);
  const worstKills = Math.min(...kills);

  console.log(`${version.padEnd(7)} | ${runs.length.toString().padEnd(4)} | ${avgKills.padEnd(9)} | ${avgDeaths.padEnd(10)} | ${avgDiedAt.padEnd(13)} | ${bestKills.toString().padEnd(10)} | ${worstKills}`);
  summary.push({ version, runs: runs.length, avgKills, avgDeaths, avgDiedAt, bestKills, worstKills });
}

console.log('\n=== RAW DATA ===\n');
console.log('Version | Run | Kills | Deaths | Died@Tick | Final HP | Final Pos');
console.log('--------|-----|-------|--------|-----------|----------|----------');
for (const row of rows) {
  console.log(`${row.version.padEnd(7)} | ${row.run.padEnd(3)} | ${row.kills.padEnd(5)} | ${row.deaths.padEnd(6)} | ${(row.died_at_tick || 'N/A').padEnd(9)} | ${row.final_hp.padEnd(8)} | (${row.final_pos_x}, ${row.final_pos_y})`);
}

// Save summary
const summaryPath = path.join(__dirname, 'results', 'summary.txt');
const summaryText = summary.map(s =>
  `${s.version}: ${s.runs} runs, avg ${s.avgKills} kills, avg ${s.avgDeaths} deaths, avg died@${s.avgDiedAt}, best ${s.bestKills}, worst ${s.worstKills}`
).join('\n');
fs.writeFileSync(summaryPath, summaryText + '\n');
console.log(`\nSummary saved to: ${summaryPath}`);

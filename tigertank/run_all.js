// run_all.js — Run multiple versions sequentially and log results to results/
// Usage: node run_all.js [runs_per_version]
// Example: node run_all.js 3   (runs each version 3 times)

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const VERSIONS = ['v26', 'v27', 'v28', 'v29', 'v30'];
const RUNS_PER_VERSION = parseInt(process.argv[2] || '1', 10);

const RESULTS_DIR = path.join(__dirname, 'results');
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

const csvPath = path.join(RESULTS_DIR, 'runs.csv');
if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(csvPath, 'version,run,timestamp,kills,deaths,died_at_tick,final_hp,final_pos_x,final_pos_y,log_file\n');
}

async function runVersion(version, runNum) {
  const scriptName = `play_tigertank${version.replace('v', '')}.js`;
  const scriptPath = path.join(__dirname, scriptName);

  if (!fs.existsSync(scriptPath)) {
    console.log(`SKIP ${version}: ${scriptName} not found`);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(RESULTS_DIR, `${version}_run${runNum}_${timestamp}.log`);

  console.log(`\n=== Running ${version} (run ${runNum}/${RUNS_PER_VERSION}) ===`);
  console.log(`Log: ${logFile}`);

  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath], { cwd: __dirname });
    const logStream = fs.createWriteStream(logFile);
    let stdout = '';

    proc.stdout.on('data', (data) => {
      const s = data.toString();
      stdout += s;
      logStream.write(s);
      process.stdout.write(s);
    });

    proc.stderr.on('data', (data) => {
      logStream.write(data);
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      logStream.end();

      // Parse results from log
      const killsMatch = stdout.match(/=== TOTAL KILLS: (\d+) ===/);
      const deathsMatch = stdout.match(/=== DEATHS: (\d+) ===/);
      const kills = killsMatch ? parseInt(killsMatch[1]) : 0;
      const deaths = deathsMatch ? parseInt(deathsMatch[1]) : 0;

      // Find last position and HP
      const lines = stdout.split('\n').filter(l => l.startsWith('Tick '));
      let diedAtTick = '';
      let finalHP = '';
      let finalPosX = '';
      let finalPosY = '';

      for (const line of lines) {
        const tickMatch = line.match(/Tick (\d+):/);
        const hpMatch = line.match(/hp=([\d.]+)\/(\d+)/);
        const posMatch = line.match(/pos=\((-?\d+),(-?\d+)\)/);

        if (tickMatch && hpMatch) {
          const tick = parseInt(tickMatch[1]);
          const hp = parseFloat(hpMatch[1]);
          if (hp <= 0 && !diedAtTick) diedAtTick = tick.toString();
          finalHP = hp.toString();
        }
        if (posMatch) {
          finalPosX = posMatch[1];
          finalPosY = posMatch[2];
        }
      }

      const csvLine = `${version},${runNum},${timestamp},${kills},${deaths},${diedAtTick},${finalHP},${finalPosX},${finalPosY},${path.basename(logFile)}\n`;
      fs.appendFileSync(csvPath, csvLine);

      console.log(`\n>>> ${version} run ${runNum}: ${kills} kills, ${deaths} deaths, died at tick ${diedAtTick || 'N/A'}`);
      resolve();
    });
  });
}

(async () => {
  console.log(`Running ${VERSIONS.length} versions × ${RUNS_PER_VERSION} runs = ${VERSIONS.length * RUNS_PER_VERSION} total runs`);
  console.log(`Results will be saved to: ${RESULTS_DIR}/`);
  console.log(`CSV summary: ${csvPath}\n`);

  for (const version of VERSIONS) {
    for (let run = 1; run <= RUNS_PER_VERSION; run++) {
      await runVersion(version, run);
    }
  }

  console.log('\n=== ALL RUNS COMPLETE ===');
  console.log(`View results: cat ${csvPath}`);
  console.log(`Or run: npm run compare`);
})();

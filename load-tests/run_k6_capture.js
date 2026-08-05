const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const k6path = 'C:\\Program Files\\k6\\k6.exe';
const outFile = path.join(__dirname, 'k6_run_output_utf8.txt');
const args = ['run', '--env', 'TOTAL_VUS=50', '--env', 'FAILED_CAPTURE_CAP=500', '--env', 'FAILED_BODY_LIMIT=4000', path.join(__dirname, 'k6_multi_scenarios.js')];

const outStream = fs.createWriteStream(outFile, { encoding: 'utf8' });
const p = spawn(k6path, args, { stdio: ['ignore', 'pipe', 'pipe'] });

p.stdout.on('data', (chunk) => { outStream.write(chunk.toString('utf8')); });
p.stderr.on('data', (chunk) => { outStream.write(chunk.toString('utf8')); });

p.on('close', (code) => {
  outStream.end();
  console.log('k6 exited', code);
  // now parse FAILED_RESPONSE lines
  const txt = fs.readFileSync(outFile, 'utf8');
  const lines = txt.split(/\r?\n/);
  const results = [];
  for (const line of lines) {
    const idx = line.indexOf('FAILED_RESPONSE:');
    if (idx !== -1) {
      const jsonPart = line.slice(idx + 'FAILED_RESPONSE:'.length).trim();
      try { results.push(JSON.parse(jsonPart)); } catch (e) {
        const m = jsonPart.match(/(\{.*\})/);
        if (m) {
          try { results.push(JSON.parse(m[1])); } catch (e2) {}
        }
      }
    }
  }
  fs.writeFileSync(path.join(__dirname, 'failed-responses-captured.json'), JSON.stringify(results, null, 2));
  console.log('WROTE failed-responses-captured.json COUNT=', results.length);
});

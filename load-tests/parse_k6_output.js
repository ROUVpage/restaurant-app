const fs = require('fs');
const path = require('path');
const inFile = path.join(__dirname, 'k6_run_output_utf8.txt');
const errFile = path.join(__dirname, 'k6_run_error.txt');
const outFile = path.join(__dirname, 'failed-responses-captured.json');
// Try to read as utf8, fall back to utf16le if needed
let txt = '';
try { txt = fs.readFileSync(inFile, 'utf8'); } catch (e) { try { txt = fs.readFileSync(inFile, 'utf16le'); } catch (e2) { txt = ''; } }
// Also include stderr output if present (k6 sometimes logs FAILED_RESPONSE to stderr)
try {
  const errTxt = fs.readFileSync(errFile, 'utf8');
  if (errTxt) txt += '\n' + errTxt;
} catch (e) {
  try {
    const errTxt = fs.readFileSync(errFile, 'utf16le');
    if (errTxt) txt += '\n' + errTxt;
  } catch (e2) {}
}
const lines = txt.split(/\r?\n/);
const results = [];
for (const line of lines) {
  // Pattern: msg="FAILED_RESPONSE:{\"ts\":...}" (k6 logs escape quotes inside msg)
  const m = line.match(/msg="FAILED_RESPONSE:((?:\\.|[^"])*)"/);
  if (m && m[1]) {
    const escaped = m[1];
    try {
      const jsonString = JSON.parse('"' + escaped + '"');
      results.push(JSON.parse(jsonString));
      continue;
    } catch (e) {}
  }
  // Fallback: find raw FAILED_RESPONSE: followed by braces
  const idx = line.indexOf('FAILED_RESPONSE:');
  if (idx !== -1) {
    const rest = line.slice(idx + 'FAILED_RESPONSE:'.length).trim();
    const m2 = rest.match(/(\{[\s\S]*\})/);
    if (m2) {
      const candidate = m2[1];
      try {
        // candidate may have escaped quotes; try to unescape via JSON.parse wrapper
        const jsonString = JSON.parse('"' + candidate + '"');
        results.push(JSON.parse(jsonString));
      } catch (e) {
        try { results.push(JSON.parse(candidate)); } catch (e2) {}
      }
    }
  }
}
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
console.log('WROTE', outFile, 'COUNT=', results.length);

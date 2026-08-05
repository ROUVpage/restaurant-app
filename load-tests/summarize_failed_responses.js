const fs = require('fs');
const path = require('path');
const inFile = path.join(__dirname, 'failed-responses-captured.json');
const outFile = path.join(__dirname, 'failed-responses-summary.json');
const data = JSON.parse(fs.readFileSync(inFile,'utf8'));
const byEndpoint = {};
for (const e of data) {
  const key = e.url + '|' + e.status;
  if (!byEndpoint[key]) byEndpoint[key] = {url: e.url, status: e.status, count:0, vus:{}, samples:[]};
  byEndpoint[key].count++;
  byEndpoint[key].vus[e.vu] = (byEndpoint[key].vus[e.vu]||0)+1;
  if (byEndpoint[key].samples.length < 5) byEndpoint[key].samples.push(e);
}
const summary = Object.values(byEndpoint).sort((a,b)=>b.count-a.count);
fs.writeFileSync(outFile, JSON.stringify({total: data.length, by: summary}, null, 2),'utf8');
console.log('WROTE', outFile, 'TOTAL=', data.length);
for (const s of summary) {
  console.log(`${s.count} failures -> ${s.url} (status ${s.status})`);
}

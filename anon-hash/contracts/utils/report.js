// scripts/report.js
// After deploying, log timestamp, addresses, and write to a JSON file
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node scripts/report.js <dmapAddress> <vaultAddress> <outputFile>');
  process.exit(1);
}

const [dmapAddress, vaultAddress, honeypotAddress, outputFile] = args;
const report = {
  timestamp: Math.floor(Date.now() / 1000), // UTC UNIX
  dmap: dmapAddress,
  vault: vaultAddress,
  honeypot: honeypotAddress
};

fs.writeFileSync(path.resolve(outputFile), JSON.stringify(report, null, 2));
console.log('Report saved to', outputFile);

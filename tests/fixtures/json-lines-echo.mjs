/* eslint-disable no-console */
/* global console, setTimeout */
import { readFileSync } from 'node:fs';
import process from 'node:process';

const count = parseInt(process.argv[2] || '1', 10);
const exitCode = parseInt(process.argv[3] || '0', 10);
const stderrMsg = process.argv[4] || '';
const sleepMs = parseInt(process.argv[5] || '0', 10);

let input = '';
try {
  // Read all stdin at once for simplicity in this fixture
  input = readFileSync(0, 'utf8');
} catch {
  // ignore
}

for (let i = 0; i < count; i++) {
  console.log(JSON.stringify({ index: i, input }));
}

if (stderrMsg) {
  process.stderr.write(stderrMsg);
}

if (sleepMs > 0) {
  setTimeout(() => {
    process.exit(exitCode);
  }, sleepMs);
} else {
  process.exit(exitCode);
}

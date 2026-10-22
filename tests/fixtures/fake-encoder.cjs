#!/usr/bin/env node
// Fake encoder used by the legacy worker characterization tests. Records the
// exact argv worker2's shell produced and optionally creates the output file.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
if (process.env.FAKE_ARGV_FILE) {
  fs.appendFileSync(process.env.FAKE_ARGV_FILE, `${JSON.stringify(argv)}\n`);
}

const outputIndex = argv.indexOf('-o');
const outputPath =
  outputIndex >= 0 ? argv[outputIndex + 1] : argv[argv.length - 1];

if (process.env.FAKE_STDOUT) process.stdout.write(process.env.FAKE_STDOUT);
if (process.env.FAKE_STDERR) process.stderr.write(process.env.FAKE_STDERR);

if (process.env.FAKE_PROGRESS) process.stderr.write(process.env.FAKE_PROGRESS);

if (process.env.FAKE_NO_OUTPUT !== '1' && outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, process.env.FAKE_OUTPUT_CONTENT || 'converted');
}

const delay = Number(process.env.FAKE_DELAY_MS || '0');
setTimeout(
  () => process.exit(Number(process.env.FAKE_EXIT_CODE || '0')),
  Number.isFinite(delay) ? delay : 0,
);

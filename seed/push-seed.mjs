#!/usr/bin/env node
// Push seed/seed.json to JSONBin.
//
// Usage:
//   BIN_ID=xxxx node seed/push-seed.mjs
//   BIN_ID=xxxx MASTER_KEY=$$$ node seed/push-seed.mjs   (if bin requires auth)
//
// Set BIN_ID to your 24-character JSONBin bin ID.
// MASTER_KEY is only needed if your bin is private — public bins can write without it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_ID = process.env.BIN_ID;
const MASTER_KEY = process.env.MASTER_KEY;

if (!BIN_ID) {
  console.error('Set BIN_ID env var. e.g.:  BIN_ID=abc123... node seed/push-seed.mjs');
  process.exit(1);
}

const seedPath = path.join(__dirname, 'seed.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

console.log(`Pushing ${seed.events?.length ?? 0} events to bin ${BIN_ID.slice(0, 8)}...`);

const headers = { 'Content-Type': 'application/json' };
if (MASTER_KEY) headers['X-Master-Key'] = MASTER_KEY;

const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(seed),
});

if (!res.ok) {
  console.error(`Failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

console.log('✓ Seed pushed successfully.');
console.log('  Open the app, it should fetch the new data on next load.');

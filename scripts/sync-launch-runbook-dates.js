#!/usr/bin/env node
'use strict';

/**
 * Phase 2b: map Smartsheet CSV export columns → plannedDates on launch-runbooks.json.
 * Usage: node scripts/sync-launch-runbook-dates.js --csv path/to/export.csv --epic WDW-191147
 *
 * Expected headers (case-insensitive, partial match OK):
 *   initial details / full details → initialDetails
 *   bookings launch → bookingsLaunch
 *   service start → serviceStart
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNBOOKS_PATH = path.join(ROOT, 'data', 'launch-runbooks.json');

function parseArgs(argv) {
  const out = { csv: null, epic: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--csv' && argv[i + 1]) out.csv = argv[++i];
    else if (argv[i] === '--epic' && argv[i + 1]) out.epic = argv[++i];
  }
  return out;
}

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mapHeaderToField(header) {
  const h = normalizeHeader(header);
  if (/initial|full details/.test(h)) return 'initialDetails';
  if (/bookings launch|booking launch/.test(h)) return 'bookingsLaunch';
  if (/service start/.test(h)) return 'serviceStart';
  return null;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ',') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function main() {
  const { csv, epic } = parseArgs(process.argv);
  if (!csv || !epic) {
    console.error('Usage: node scripts/sync-launch-runbook-dates.js --csv export.csv --epic WDW-191147');
    process.exit(1);
  }
  const text = fs.readFileSync(path.resolve(csv), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.error('CSV needs header + at least one row');
    process.exit(1);
  }
  const headers = parseCsvLine(lines[0]);
  const colMap = headers.map((h) => mapHeaderToField(h));
  const row = parseCsvLine(lines[1]);
  const planned = {};
  colMap.forEach((field, i) => {
    if (field && row[i]) planned[field] = row[i];
  });
  const runbooks = JSON.parse(fs.readFileSync(RUNBOOKS_PATH, 'utf8'));
  if (!runbooks[epic]) {
    console.error('Epic not in launch-runbooks.json:', epic);
    process.exit(1);
  }
  runbooks[epic].plannedDates = Object.assign({}, runbooks[epic].plannedDates || {}, planned);
  fs.writeFileSync(RUNBOOKS_PATH, JSON.stringify(runbooks, null, 2) + '\n', 'utf8');
  console.log('Updated plannedDates for', epic, planned);
}

main();

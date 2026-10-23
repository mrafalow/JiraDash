#!/usr/bin/env node
'use strict';

/**
 * Import a Smartsheet task export → rowOverrides + plannedDatesByRow on launch-runbooks.json.
 *
 * Usage:
 *   node scripts/import-launch-runbook-tasks.js --csv runbook-tasks.csv --epic WDW-191147
 *
 * Expected columns (header names matched loosely, case-insensitive):
 *   Task / Task Name
 *   Status  → "Not Applicable" sets rowOverrides[rowId].applies = false when alias matches
 *   Finish / Due / End Date → plannedDatesByRow[rowId]
 *   Phase / Section (optional, for logging only)
 *
 * Milestone dates (bookings / service) still use scripts/sync-launch-runbook-dates.js.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNBOOKS_PATH = path.join(ROOT, 'data', 'launch-runbooks.json');
const ALIASES_PATH = path.join(ROOT, 'data', 'launch-runbook-task-aliases.json');

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

function detectColumns(headers) {
  const norm = headers.map(normalizeHeader);
  const col = { task: -1, status: -1, date: -1, phase: -1 };
  norm.forEach((h, i) => {
    if (col.task < 0 && /^(task|task name|name)$/.test(h)) col.task = i;
    if (col.status < 0 && h === 'status') col.status = i;
    if (col.date < 0 && /finish|due|end date|planned|start date/.test(h)) col.date = i;
    if (col.phase < 0 && /phase|section/.test(h)) col.phase = i;
  });
  return col;
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

function isNotApplicable(status) {
  const s = normalizeHeader(status);
  return s === 'not applicable' || s === 'n/a' || s === 'na';
}

function rowIdForTask(taskName, aliases) {
  const t = normalizeHeader(taskName);
  if (!t) return null;
  for (const a of aliases) {
    const m = normalizeHeader(a.match);
    if (m && t.includes(m)) return a.rowId;
  }
  return null;
}

function main() {
  const { csv, epic } = parseArgs(process.argv);
  if (!csv || !epic) {
    console.error(
      'Usage: node scripts/import-launch-runbook-tasks.js --csv runbook-tasks.csv --epic WDW-191147'
    );
    process.exit(1);
  }
  const aliasDoc = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8'));
  const aliases = aliasDoc.aliases || [];

  const text = fs.readFileSync(path.resolve(csv), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.error('CSV needs header + at least one row');
    process.exit(1);
  }
  const headers = parseCsvLine(lines[0]);
  const col = detectColumns(headers);
  if (col.task < 0) {
    console.error('Could not find Task column in CSV headers:', headers.join(', '));
    process.exit(1);
  }

  const runbooks = JSON.parse(fs.readFileSync(RUNBOOKS_PATH, 'utf8'));
  if (!runbooks[epic]) {
    console.error('Epic not in launch-runbooks.json:', epic);
    process.exit(1);
  }
  const entry = runbooks[epic];
  entry.rowOverrides = entry.rowOverrides || {};
  entry.plannedDatesByRow = entry.plannedDatesByRow || {};

  let naCount = 0;
  let dateCount = 0;
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    const task = cells[col.task];
    const status = col.status >= 0 ? cells[col.status] : '';
    const date = col.date >= 0 ? cells[col.date] : '';
    const rowId = rowIdForTask(task, aliases);
    if (!rowId) continue;
    if (isNotApplicable(status)) {
      entry.rowOverrides[rowId] = Object.assign({}, entry.rowOverrides[rowId], { applies: false });
      naCount++;
      console.log('N/A → hide row', rowId, '←', task);
    }
    if (date) {
      entry.plannedDatesByRow[rowId] = date;
      dateCount++;
    }
  }

  fs.writeFileSync(RUNBOOKS_PATH, JSON.stringify(runbooks, null, 2) + '\n', 'utf8');
  console.log('Updated', epic, '—', naCount, 'Not Applicable overrides,', dateCount, 'plannedDatesByRow');
}

main();

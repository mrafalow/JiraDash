#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'component-role-by-id.json');

function overlayPath() {
  const data = (process.env.DSCRIBE_DATA || '').trim();
  if (data) {
    const p = path.join(data, 'dscribe', 'crawl_overlay.json');
    if (fs.existsSync(p)) return p;
  }
  const home = path.join(
    process.env.HOME || '',
    'Documents',
    'disney-dining-content-ops-full',
    'data',
    'dscribe',
    'crawl_overlay.json'
  );
  if (process.env.HOME && fs.existsSync(home)) return home;
  return null;
}

function main() {
  const src = overlayPath();
  if (!src) {
    console.error('crawl_overlay.json not found. Set DSCRIBE_DATA.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
  const roles = {};
  for (const rec of raw.records || []) {
    if (rec && rec.id && rec.component_role) roles[rec.id] = rec.component_role;
  }
  const out = { version: 1, source: src, count: Object.keys(roles).length, roles };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log('Wrote ' + out.count + ' roles to ' + OUT);
}

main();

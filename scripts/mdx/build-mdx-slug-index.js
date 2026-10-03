#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { catalogPaths, indexFromCatalogJson } = require('./mdx-facility.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'mdx-facility-by-slug.json');

function main() {
  let map = new Map();
  for (const p of catalogPaths()) {
    if (p === OUT) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!raw.facilities) continue;
      const next = indexFromCatalogJson(raw);
      if (next.size > map.size) map = next;
    } catch (_) {
      /* skip */
    }
  }
  if (!map.size) {
    console.error(
      'No WDW facilities found. Set DSCRIBE_DATA to disney-dining-content-ops-full/data and re-run.'
    );
    process.exit(1);
  }
  const entries = {};
  map.forEach((v, k) => {
    entries[k] = v;
  });
  const out = {
    version: 1,
    generatedFrom: 'qs_facility_catalog (WDW, destination filter)',
    count: Object.keys(entries).length,
    entries
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote ' + out.count + ' slug entries to ' + OUT);
}

main();

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let cache = null;

function loadChainSupplementsBySlug() {
  if (cache) return cache;
  const p = path.join(ROOT, 'data', 'dining-chain-supplements-by-slug.json');
  try {
    cache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    cache = {};
  }
  return cache;
}

module.exports = { loadChainSupplementsBySlug };

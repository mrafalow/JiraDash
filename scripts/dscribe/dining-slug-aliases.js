'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ALIAS_PATH = path.join(ROOT, 'data', 'dining-slug-aliases.json');

let cache = null;

function loadSlugAliasesByUrlSlug() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(ALIAS_PATH, 'utf8'));
    cache = raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    cache = {};
  }
  return cache;
}

function indexSlugForUrlSlug(urlSlug, aliases) {
  const map = aliases || loadSlugAliasesByUrlSlug();
  const key = String(urlSlug || '').toLowerCase();
  return map[key] || urlSlug;
}

module.exports = { loadSlugAliasesByUrlSlug, indexSlugForUrlSlug, ALIAS_PATH };

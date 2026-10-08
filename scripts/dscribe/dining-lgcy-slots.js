'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let cache = null;

function loadLgcySlotsBySlug() {
  if (cache) return cache;
  const paths = [
    path.join(ROOT, 'data', 'dining-lgcy-slots-by-slug.json'),
    process.env.DSCRIBE_DATA
      ? path.join(process.env.DSCRIBE_DATA.trim(), 'dining-lgcy-slots-by-slug.json')
      : null
  ].filter(Boolean);
  for (const p of paths) {
    try {
      cache = JSON.parse(fs.readFileSync(p, 'utf8'));
      return cache;
    } catch (_) {
      /* try next */
    }
  }
  cache = {};
  return cache;
}

function lgcySlotForSlug(slug) {
  if (!slug) return null;
  const map = loadLgcySlotsBySlug();
  const slot = map[slug];
  if (!slot || !slot.pageParentChain || !slot.pageParentChain.length) return null;
  return Object.assign({}, slot);
}

module.exports = { loadLgcySlotsBySlug, lgcySlotForSlug };

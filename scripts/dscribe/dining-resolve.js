'use strict';

const fs = require('fs');
const path = require('path');
const links = require('./dscribe-links.js');
const core = require('./dining-resolve-core.js');

const ROOT = path.join(__dirname, '..', '..');
let indexCache = null;
let indexMtime = 0;

function indexPaths() {
  const paths = [path.join(ROOT, 'data', 'dining-slug-index.json')];
  const data = (process.env.DSCRIBE_DATA || '').trim();
  if (data) {
    paths.push(path.join(data, 'dining-slug-index.json'));
  }
  return paths;
}

function loadIndex() {
  for (const p of indexPaths()) {
    try {
      const st = fs.statSync(p);
      if (indexCache && p === indexCache._path && st.mtimeMs === indexMtime) {
        return indexCache;
      }
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      indexCache = { _path: p, entries: raw.entries || raw };
      indexMtime = st.mtimeMs;
      return indexCache;
    } catch (_) {
      continue;
    }
  }
  indexCache = { _path: null, entries: {} };
  return indexCache;
}

function resolveDiningUrl(rawUrl) {
  const { entries } = loadIndex();
  return core.resolveDiningUrl(rawUrl, links, entries);
}

module.exports = { resolveDiningUrl, loadIndex };

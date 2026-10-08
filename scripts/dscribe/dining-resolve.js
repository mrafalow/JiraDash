'use strict';

const fs = require('fs');
const path = require('path');
const links = require('./dscribe-links.js');
const core = require('./dining-resolve-core.js');
const { mergeIndexEntries, enrichResult } = require('./dscribe-enrich.js');
const { loadLgcySlotsBySlug } = require('./dining-lgcy-slots.js');
const { loadChainSupplementsBySlug } = require('./dining-chain-supplements.js');
const { mdxPayloadForResolve } = require('../mdx/mdx-facility.js');

const ROOT = path.join(__dirname, '..', '..');
let indexCache = null;
let indexSignature = '';

function indexPaths() {
  const paths = [];
  const data = (process.env.DSCRIBE_DATA || '').trim();
  if (data) {
    paths.push(path.join(data, 'dining-slug-index.json'));
  }
  paths.push(path.join(ROOT, 'data', 'dining-slug-index.json'));
  return paths;
}

function loadIndexFile(p) {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw.entries || raw;
}

function loadIndex() {
  const paths = indexPaths();
  let signature = paths.map((p) => {
    try {
      return p + ':' + fs.statSync(p).mtimeMs;
    } catch (_) {
      return p + ':missing';
    }
  }).join('|');
  if (indexCache && signature === indexSignature) {
    return indexCache;
  }
  let merged = {};
  paths.forEach((p) => {
    try {
      merged = mergeIndexEntries(merged, loadIndexFile(p));
    } catch (_) {
      /* skip */
    }
  });
  indexCache = { _path: paths[0], entries: merged };
  indexSignature = signature;
  return indexCache;
}

async function resolveDiningUrl(rawUrl) {
  const { entries } = loadIndex();
  const lgcySlots = loadLgcySlotsBySlug();
  const chainSupplements = loadChainSupplementsBySlug();
  let result = core.resolveDiningUrl(rawUrl, links, entries, lgcySlots, chainSupplements);
  if (!result.ok) return result;
  result = await enrichResult(result, links, entries);
  if (result._entry) delete result._entry;
  result.mdx = mdxPayloadForResolve(result.slug);
  return result;
}

function resolveDiningUrlSync(rawUrl) {
  const { entries } = loadIndex();
  const lgcySlots = loadLgcySlotsBySlug();
  const chainSupplements = loadChainSupplementsBySlug();
  const result = core.resolveDiningUrl(rawUrl, links, entries, lgcySlots, chainSupplements);
  if (result.ok) result.mdx = mdxPayloadForResolve(result.slug);
  return result;
}

module.exports = { resolveDiningUrl, resolveDiningUrlSync, loadIndex };

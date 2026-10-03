'use strict';

const core = require('./dining-resolve-core.js');
const links = require('./dscribe-links.js');
const { loadIndex } = require('./dining-resolve.js');
const { buildOfflineFacilityGraph } = require('./facility-graph.js');

function buildGraphForUrl(rawUrl) {
  const norm = links.normalizeProdUrl(rawUrl);
  if (norm.error) return { ok: false, error: norm.error };

  const { entries } = loadIndex();
  const entry = core.lookupEntry(entries, norm.lookupKey, norm.slug);
  const displayName = entry
    ? entry.displayName || links.titleCaseSlug(norm.slug)
    : links.titleCaseSlug(norm.slug);

  return buildOfflineFacilityGraph(entry, {
    displayName,
    slug: norm.slug,
    lookupKey: norm.lookupKey
  });
}

module.exports = { buildGraphForUrl };

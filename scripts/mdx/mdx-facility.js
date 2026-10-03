'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** @type {Map<string, object> | null} */
let slugIndex = null;
let indexSignature = '';

function catalogPaths() {
  const paths = [];
  const data = (process.env.DSCRIBE_DATA || '').trim();
  if (data) {
    paths.push(path.join(data, 'shared', 'qs_facility_catalog.production.json'));
    paths.push(path.join(data, 'shared', 'qs_facility_catalog.json'));
  }
  paths.push(path.join(ROOT, 'data', 'mdx-facility-by-slug.json'));
  const home = path.join(
    process.env.HOME || '',
    'Documents',
    'disney-dining-content-ops-full',
    'data',
    'shared',
    'qs_facility_catalog.production.json'
  );
  if (process.env.HOME) paths.push(home);
  return paths;
}

function mdxEntityTypeFromRecord(rec) {
  if (rec.entityType) return rec.entityType;
  const ct = String(rec.contentType || '').toLowerCase();
  if (ct === 'event') return 'Event';
  if (ct === 'foodbeveragefacility') return 'restaurant';
  return 'restaurant';
}

function buildHref(facilityId, entityType) {
  return (
    'mdx://finder/detail?facilityId=' +
    encodeURIComponent(String(facilityId)) +
    ';entityType=' +
    encodeURIComponent(String(entityType))
  );
}

function indexFromCatalogJson(raw) {
  const map = new Map();
  const list = raw.facilities || raw.entries || raw;
  if (!Array.isArray(list)) return map;
  for (const f of list) {
    if (!f || !f.osid) continue;
    const dest = f.destination || 'WDW';
    if (dest !== 'WDW') continue;
    const entityType = mdxEntityTypeFromRecord(f);
    const payload = {
      facilityId: String(f.osid),
      entityType,
      name: f.name || '',
      slug: f.slug || f.dscribe_slug || '',
      destination: dest,
      href: buildHref(f.osid, entityType)
    };
    const slugs = new Set([f.slug, f.dscribe_slug].filter(Boolean));
    for (const slug of slugs) {
      const key = String(slug).toLowerCase();
      if (!map.has(key)) map.set(key, payload);
    }
  }
  return map;
}

function indexFromSlugJson(raw) {
  const map = new Map();
  const entries = raw.entries || raw;
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    Object.keys(entries).forEach((k) => {
      const v = entries[k];
      if (v && v.facilityId) map.set(k.toLowerCase(), v);
    });
  }
  return map;
}

function loadSlugIndex() {
  const paths = catalogPaths();
  const signature = paths
    .map((p) => {
      try {
        return p + ':' + fs.statSync(p).mtimeMs;
      } catch (_) {
        return p + ':missing';
      }
    })
    .join('|');
  if (slugIndex && signature === indexSignature) return slugIndex;
  indexSignature = signature;

  let map = new Map();
  for (const p of paths) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const next =
        raw.facilities || Array.isArray(raw)
          ? indexFromCatalogJson(raw)
          : indexFromSlugJson(raw);
      if (next.size > map.size) map = next;
    } catch (_) {
      /* try next path */
    }
  }
  slugIndex = map;
  return slugIndex;
}

/**
 * @param {string} slug - URL friendly id
 * @param {{ destination?: string }} [opts]
 */
function lookupMdxFacility(slug, opts) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) {
    return { ok: false, note: 'Missing facility slug.' };
  }
  const map = loadSlugIndex();
  const hit = map.get(s);
  if (!hit) {
    return {
      ok: false,
      note:
        'No facility ID in local catalog for this slug. Rebuild data/mdx-facility-by-slug.json or set DSCRIBE_DATA to dining-content-ops data.'
    };
  }
  const entityType = hit.entityType || 'restaurant';
  const facilityId = hit.facilityId;
  const href = hit.href || buildHref(facilityId, entityType);
  const label = hit.name || slug;
  return {
    ok: true,
    facilityId,
    entityType,
    href,
    htmlSnippet:
      '<a href="' + href + '">' + label.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</a>',
    name: hit.name || null,
    note: null
  };
}

function mdxPayloadForResolve(slug) {
  return lookupMdxFacility(slug, { destination: 'WDW' });
}

module.exports = {
  buildHref,
  lookupMdxFacility,
  mdxPayloadForResolve,
  loadSlugIndex,
  catalogPaths,
  indexFromCatalogJson
};

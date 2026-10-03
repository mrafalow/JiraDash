'use strict';

function parkFromLookupKey(lookupKey) {
  if (!lookupKey || !lookupKey.includes('/')) return '';
  return lookupKey.split('/')[0];
}

function entryParkSegment(indexKey, entry) {
  if (entry && entry.parkSegment) return entry.parkSegment;
  if (indexKey && indexKey.includes('/')) return indexKey.split('/')[0];
  return '';
}

function mergeSlots(existing, incoming, allowLongerReplace) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const out = Object.assign({}, existing);
  const bbIn = incoming.bbParentChain || [];
  const bbOut = out.bbParentChain || [];
  if (!bbOut.length && bbIn.length) out.bbParentChain = bbIn;
  else if (allowLongerReplace && bbIn.length > bbOut.length) out.bbParentChain = bbIn;
  const pgIn = incoming.pageParentChain || [];
  const pgOut = out.pageParentChain || [];
  if (!pgOut.length && pgIn.length) {
    out.pageParentChain = pgIn;
    out.pageTcm = incoming.pageTcm || out.pageTcm;
    out.itemNumber = incoming.itemNumber || out.itemNumber;
    out.pageTitle = incoming.pageTitle || out.pageTitle;
  } else if (allowLongerReplace && pgIn.length > pgOut.length) {
    out.pageParentChain = pgIn;
    out.pageTcm = incoming.pageTcm || out.pageTcm;
    out.itemNumber = incoming.itemNumber || out.itemNumber;
    out.pageTitle = incoming.pageTitle || out.pageTitle;
  }
  return out;
}

function mergeIndexEntry(existing, incoming, allowLongerReplace) {
  if (!incoming) return existing;
  if (!existing) return Object.assign({}, incoming);
  const out = Object.assign({}, existing);
  out.displayName = incoming.displayName || out.displayName;
  const replace = allowLongerReplace !== false;
  ['evo040', 'evo065', 'lgcy065'].forEach((k) => {
    out[k] = mergeSlots(out[k], incoming[k], replace);
  });
  return out;
}

function lookupEntry(entries, lookupKey, slug) {
  if (!entries || typeof entries !== 'object') return null;
  const urlPark = parkFromLookupKey(lookupKey);
  let merged = entries[lookupKey] ? Object.assign({}, entries[lookupKey]) : null;

  for (const k of Object.keys(entries)) {
    const e = entries[k];
    if (!e) continue;
    const sameSlug = e.slug === slug || k.endsWith('/' + slug) || k === slug;
    if (!sameSlug || k === lookupKey) continue;

    const samePark = urlPark && entryParkSegment(k, e) === urlPark;
    if (!merged) {
      if (!urlPark || samePark) merged = Object.assign({}, e);
      continue;
    }
    merged = mergeIndexEntry(merged, e, samePark);
  }

  if (!merged && entries[slug]) merged = Object.assign({}, entries[slug]);
  return merged;
}

function slotForPub(entry, pubKey) {
  if (!entry) return null;
  if (pubKey === 'evo040') return entry.evo040 || null;
  if (pubKey === 'evo065') return entry.evo065 || entry.evo || null;
  if (pubKey === 'lgcy065') return entry.lgcy065 || entry.lgcy || null;
  return null;
}

function pageChainFromSlot(slot) {
  if (!slot) return [];
  if (Array.isArray(slot.pageParentChain) && slot.pageParentChain.length) {
    return slot.pageParentChain;
  }
  if (Array.isArray(slot.parentChain) && slot.parentChain.length) {
    return slot.parentChain;
  }
  return [];
}

function bbChainFromSlot(slot) {
  if (!slot) return [];
  if (Array.isArray(slot.bbParentChain) && slot.bbParentChain.length) {
    return slot.bbParentChain;
  }
  return [];
}

/**
 * Category payload: Building Blocks + Root/Page Level (facility-deep when indexed).
 * @param {object} links - dscribe-links module
 * @param {'evo040'|'evo065'|'lgcy065'} pubKey
 * @param {object|null} slot - index slot for this pub
 */
function categoryPayload(links, pubKey, slot) {
  const bbChain = bbChainFromSlot(slot);
  const pageChain = pageChainFromSlot(slot);
  const buildingBlocksUrl = links.facilityBuildingBlocksExplorer(pubKey, bbChain);
  const rootPageLevelUrl = links.facilityRootPageExplorer(pubKey, pageChain);

  let note = null;
  if (!slot) {
    note =
      'No facility folders in index for this slug — opening publication-level folders. Rebuild data/dining-slug-index.json from crawl.';
  } else if (!bbChain.length && !pageChain.length) {
    note =
      'Index has no BB/page folder chains — opening publication-level folders. Rebuild with DSCRIBE_DATA crawl.';
  } else if (!bbChain.length) {
    note =
      'No Building Blocks folder chain in index — BB link opens publication Building Blocks.';
  } else if (!pageChain.length) {
    note =
      'No Root/page folder chain in index — Root link opens publication Root.';
  }

  return {
    buildingBlocksUrl,
    rootPageLevelUrl,
    note
  };
}

/**
 * Resolve a prod dining URL using link builders + slug index entries (no I/O).
 * @param {string} rawUrl
 * @param {object} links - dscribe-links module
 * @param {object} entries - dining-slug-index entries map
 */
function resolveDiningUrl(rawUrl, links, entries) {
  const norm = links.normalizeProdUrl(rawUrl);
  if (norm.error) {
    return { ok: false, error: norm.error };
  }

  const entry = lookupEntry(entries, norm.lookupKey, norm.slug);
  const displayName = entry
    ? entry.displayName || links.titleCaseSlug(norm.slug)
    : links.titleCaseSlug(norm.slug);

  const warnings = [];
  if (!entry) {
    warnings.push(
      'Slug not found in dining index — showing title from URL only. Rebuild data/dining-slug-index.json from crawl.'
    );
  } else {
    const hasAny =
      slotForPub(entry, 'evo040') ||
      slotForPub(entry, 'evo065') ||
      slotForPub(entry, 'lgcy065');
    if (!hasAny) {
      warnings.push('Index entry has no EVO040 / EVO065 / LGCY065 folder metadata.');
    }
  }

  const locales = (links.LOCALES || []).map((locale) => ({
    locale,
    url: links.localeLatestUrl(norm.prodUrl, locale)
  }));

  return {
    ok: true,
    slug: norm.slug,
    parkSegment: norm.parkSegment,
    lookupKey: norm.lookupKey,
    displayName,
    prodUrl: norm.prodUrl,
    stageUrl: links.stageUrlFromProd(norm.prodUrl),
    latestUrl: links.latestUrlFromProd(norm.prodUrl),
    locales,
    evo040: categoryPayload(links, 'evo040', slotForPub(entry, 'evo040')),
    evo065: categoryPayload(links, 'evo065', slotForPub(entry, 'evo065')),
    lgcy065: categoryPayload(links, 'lgcy065', slotForPub(entry, 'lgcy065')),
    warnings,
    _entry: entry || null
  };
}

const api = {
  lookupEntry,
  mergeIndexEntry,
  slotForPub,
  categoryPayload,
  resolveDiningUrl
};

if (typeof globalThis !== 'undefined') {
  globalThis.DiningResolveCore = api;
}
if (typeof module === 'object' && module.exports) {
  module.exports = api;
}

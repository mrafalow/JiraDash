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

function indexKeyMatchesSlug(indexKey, entry, slug) {
  if (!slug) return false;
  const e = entry || {};
  return e.slug === slug || indexKey === slug || indexKey.endsWith('/' + slug);
}

/** Richness score for picking the best index row when URL park prefix ≠ CMS path. */
function entryChainScore(entry) {
  if (!entry) return 0;
  let score = 0;
  ['evo040', 'evo065', 'lgcy065'].forEach((pubKey) => {
    const slot = slotForPub(entry, pubKey);
    if (!slot) return;
    score += bbChainFromSlot(slot).length + pageChainFromSlot(slot).length;
    if (slot.pageTcm) score += 2;
  });
  return score;
}

function mergeSlugFallback(entries, lookupKey, slug, existing) {
  if (!slug || !entries) return existing;
  let fallback = existing ? Object.assign({}, existing) : null;
  for (const k of Object.keys(entries)) {
    const e = entries[k];
    if (!e || k === lookupKey) continue;
    if (!indexKeyMatchesSlug(k, e, slug)) continue;
    fallback = fallback ? mergeIndexEntry(fallback, e, true) : Object.assign({}, e);
  }
  return fallback;
}

function lookupEntry(entries, lookupKey, slug) {
  if (!entries || typeof entries !== 'object') return null;
  const urlPark = parkFromLookupKey(lookupKey);
  let merged = entries[lookupKey] ? Object.assign({}, entries[lookupKey]) : null;

  for (const k of Object.keys(entries)) {
    const e = entries[k];
    if (!e) continue;
    const sameSlug = indexKeyMatchesSlug(k, e, slug);
    if (!sameSlug || k === lookupKey) continue;

    const samePark = urlPark && entryParkSegment(k, e) === urlPark;
    if (!merged) {
      if (!urlPark || samePark) merged = Object.assign({}, e);
      continue;
    }
    merged = mergeIndexEntry(merged, e, samePark);
  }

  if (!merged && entries[slug]) merged = Object.assign({}, entries[slug]);

  const fallback = mergeSlugFallback(entries, lookupKey, slug, merged);
  const before = entryChainScore(merged);
  const after = entryChainScore(fallback);
  if (fallback && (!merged || after > before)) merged = fallback;

  return merged;
}

function rawSlotForPub(entry, pubKey) {
  if (!entry) return null;
  if (pubKey === 'evo040') return entry.evo040 || null;
  if (pubKey === 'evo065') return entry.evo065 || entry.evo || null;
  if (pubKey === 'lgcy065') return entry.lgcy065 || entry.lgcy || null;
  return null;
}

function slotHasFacilityChains(slot) {
  return bbChainFromSlot(slot).length > 0 || pageChainFromSlot(slot).length > 0;
}

function sourcePubFromChain(chain) {
  if (!chain || !chain.length) return '';
  const body = String(chain[0]).split(':')[1] || '';
  return body.split('-')[0] || '';
}

function slotQualityScore(slot, pubKey) {
  if (!slot) return -1;
  const bb = bbChainFromSlot(slot);
  const pg = pageChainFromSlot(slot);
  let score = pg.length * 20 + bb.length;
  if (pubKey === 'evo040' || pubKey === 'evo065') {
    const bbPub = sourcePubFromChain(bb);
    if (bbPub === '472') score += 500;
    else if (bbPub === '501') score -= 200;
  }
  if (slot.itemNumber) score += 5;
  return score;
}

function bestSlotForPubFromSlugRows(entries, slug, pubKey) {
  if (!entries || !slug) return null;
  let best = null;
  let bestScore = -1;
  for (const k of Object.keys(entries)) {
    const row = entries[k];
    if (!row || !indexKeyMatchesSlug(k, row, slug)) continue;
    const slot = rawSlotForPub(row, pubKey);
    const score = slotQualityScore(slot, pubKey);
    if (score > bestScore) {
      bestScore = score;
      best = slot;
    }
  }
  return best;
}

/** Pick richest EVO040/065 chains across all index rows for this slug (472 BB beats 501 migration). */
function enrichEntryFromSlugScan(entry, ctx) {
  if (!entry || !ctx || !ctx.entries || !ctx.slug) return entry;
  const out = Object.assign({}, entry);
  ['evo040', 'evo065'].forEach((pubKey) => {
    const best = bestSlotForPubFromSlugRows(ctx.entries, ctx.slug, pubKey);
    if (!best) return;
    if (slotQualityScore(best, pubKey) > slotQualityScore(out[pubKey], pubKey)) {
      out[pubKey] = Object.assign({}, best);
    }
  });
  const supplements = ctx.chainSupplementsBySlug && ctx.chainSupplementsBySlug[ctx.slug];
  if (supplements) {
    ['evo040', 'evo065', 'lgcy065'].forEach((pubKey) => {
      const patch = supplements[pubKey];
      if (!patch) return;
      out[pubKey] = mergeSlots(out[pubKey], patch, true);
    });
  }
  return out;
}

function slotForPub(entry, pubKey, ctx) {
  if (!entry) return null;
  if (pubKey === 'evo040') return entry.evo040 || null;
  if (pubKey === 'evo065') return entry.evo065 || entry.evo || null;
  if (pubKey === 'lgcy065') {
    let slot = rawSlotForPub(entry, 'lgcy065');
    const supplement =
      ctx && ctx.lgcySlotsBySlug && ctx.slug ? ctx.lgcySlotsBySlug[ctx.slug] : null;
    if (supplement && supplement.pageParentChain && supplement.pageParentChain.length) {
      const merged = Object.assign({}, supplement, { lgcyFromPageItem: true });
      slot = slot ? mergeSlots(slot, merged, true) : merged;
    }
    return slot;
  }
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
  let rootPageLevelUrl = links.facilityRootPageExplorer(pubKey, pageChain);
  if (slot && slot.itemNumber && pageChain.length && links.pageFolderExplorer) {
    const withItem = links.pageFolderExplorer(pubKey, pageChain, slot.itemNumber);
    if (withItem) rootPageLevelUrl = withItem;
  }

  let note = null;
  if (!slot) {
    note =
      'No facility folders in index for this slug — opening publication-level folders. Rebuild data/dining-slug-index.json from crawl.';
  } else if (slot.lgcyFromPageItem && pubKey === 'lgcy065') {
    note =
      'LGCY065 page folder from pub 627 supplement (CMS page title may differ from URL slug).';
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
 * @param {object} [lgcySlotsBySlug] - optional pub 627 page chains by prod slug
 * @param {object} [chainSupplementsBySlug] - optional per-slug EVO/LGCY chain patches
 */
function resolveDiningUrl(rawUrl, links, entries, lgcySlotsBySlug, chainSupplementsBySlug) {
  const norm = links.normalizeProdUrl(rawUrl);
  if (norm.error) {
    return { ok: false, error: norm.error };
  }

  const merged = lookupEntry(entries, norm.lookupKey, norm.slug);
  const slotCtx = {
    entries,
    slug: norm.slug,
    lgcySlotsBySlug: lgcySlotsBySlug || null,
    chainSupplementsBySlug: chainSupplementsBySlug || null
  };
  const entry = merged ? enrichEntryFromSlugScan(merged, slotCtx) : merged;
  const displayName = entry
    ? entry.displayName || links.titleCaseSlug(norm.slug)
    : links.titleCaseSlug(norm.slug);

  const warnings = [];
  if (!entry) {
    warnings.push(
      'Slug not found in dining index — showing title from URL only. Rebuild data/dining-slug-index.json from crawl.'
    );
  } else if (
    norm.lookupKey &&
    !entries[norm.lookupKey] &&
    norm.parkSegment &&
    entry.displayName
  ) {
    warnings.push(
      'No index row for this URL path — using CMS folder data from the same facility slug under a different path prefix.'
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
    evo040: categoryPayload(links, 'evo040', slotForPub(entry, 'evo040', slotCtx)),
    evo065: categoryPayload(links, 'evo065', slotForPub(entry, 'evo065', slotCtx)),
    lgcy065: categoryPayload(links, 'lgcy065', slotForPub(entry, 'lgcy065', slotCtx)),
    warnings,
    _entry: entry || null
  };
}

const api = {
  lookupEntry,
  mergeIndexEntry,
  rawSlotForPub,
  enrichEntryFromSlugScan,
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

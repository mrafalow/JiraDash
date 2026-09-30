'use strict';

function lookupEntry(entries, lookupKey, slug) {
  if (!entries || typeof entries !== 'object') return null;
  if (entries[lookupKey]) return entries[lookupKey];
  if (entries[slug]) return entries[slug];
  for (const k of Object.keys(entries)) {
    if (k.endsWith('/' + slug) || k === slug) return entries[k];
  }
  return null;
}

function treePayload(links, pubKey, pageEntry) {
  const pub = links.PUBLISH_PUBS[pubKey];
  if (!pageEntry) {
    return {
      pageTcm: null,
      pageTitle: null,
      editorPageUrl: null,
      explorerFolderUrl: null,
      publicationRootUrl: links.publicationRootExplorer(pubKey),
      publicationBuildingBlocksUrl: links.publicationBuildingBlocksExplorer(pubKey),
      note: 'No structure page in index for this slug.'
    };
  }
  const itemNumber = pageEntry.itemNumber;
  return {
    pageTcm: links.remapTcmToPublishPub(pageEntry.pageTcm, pub.id),
    pageTitle: pageEntry.pageTitle,
    editorPageUrl: links.editorPageUrl(pub.id, itemNumber),
    explorerFolderUrl: links.pageFolderExplorer(
      pubKey,
      pageEntry.parentChain || [],
      itemNumber
    ),
    publicationRootUrl: links.publicationRootExplorer(pubKey),
    publicationBuildingBlocksUrl: links.publicationBuildingBlocksExplorer(pubKey),
    note: null
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
  } else if (!entry.evo && !entry.lgcy) {
    warnings.push('Index entry has no EVO or LGCY page metadata.');
  }

  return {
    ok: true,
    slug: norm.slug,
    parkSegment: norm.parkSegment,
    lookupKey: norm.lookupKey,
    displayName,
    prodUrl: norm.prodUrl,
    stageUrl: links.stageUrlFromProd(norm.prodUrl),
    stageUrlEnCa: links.stageUrlFromProd(norm.prodUrl, 'en_CA'),
    evo: treePayload(links, 'evo065', entry && entry.evo),
    lgcy: treePayload(links, 'lgcy065', entry && entry.lgcy),
    warnings
  };
}

const api = { lookupEntry, treePayload, resolveDiningUrl };

if (typeof module === 'object' && module.exports) {
  module.exports = api;
} else if (typeof globalThis !== 'undefined') {
  globalThis.DiningResolveCore = api;
}

'use strict';

const fs = require('fs');
const path = require('path');
const links = require('./dscribe-links.js');

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

function lookupEntry(lookupKey, slug) {
  const { entries } = loadIndex();
  if (entries[lookupKey]) return entries[lookupKey];
  if (entries[slug]) return entries[slug];
  for (const k of Object.keys(entries)) {
    if (k.endsWith('/' + slug) || k === slug) return entries[k];
  }
  return null;
}

function treePayload(pubKey, pageEntry) {
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

function resolveDiningUrl(rawUrl) {
  const norm = links.normalizeProdUrl(rawUrl);
  if (norm.error) {
    return { ok: false, error: norm.error };
  }

  const entry = lookupEntry(norm.lookupKey, norm.slug);
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
    evo: treePayload('evo065', entry && entry.evo),
    lgcy: treePayload('lgcy065', entry && entry.lgcy),
    warnings
  };
}

module.exports = { resolveDiningUrl, loadIndex };

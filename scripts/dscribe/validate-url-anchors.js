'use strict';

/**
 * WDW prod URL path anchors Validate accepts (first match wins if multiple appear).
 * Keep in sync with validate.js inline resolver.
 */
const VALIDATE_URL_ANCHORS = [
  'dining',
  'entertainment',
  'destinations',
  'events',
  'things-to-do'
];

/** Substrings used when matching D-Scribe folder paths (crawl + live search). */
const CMS_FOLDER_PATH_TOKENS = [
  'dining',
  'entertainment',
  'destinations',
  'destination',
  'events',
  'things-to-do',
  'resort-dining',
  'resort'
];

function findUrlAnchor(segments) {
  const segs = segments || [];
  for (const anchor of VALIDATE_URL_ANCHORS) {
    const idx = segs.indexOf(anchor);
    if (idx >= 0) {
      return { anchorIdx: idx, section: anchor, contentKind: anchor };
    }
  }
  return null;
}

function validatePathHint() {
  return VALIDATE_URL_ANCHORS.map((a) => '/' + a + '/').join(', ');
}

function pathMentionsIndexablePath(pathLower, contentKind) {
  const path = String(pathLower || '').toLowerCase();
  if (contentKind && contentKind !== 'dining' && path.includes(contentKind)) return true;
  return CMS_FOLDER_PATH_TOKENS.some((t) => path.includes(t));
}

function pathMentionsIndexableItem(it, contentKind) {
  const id = String((it && (it.id || it.Id)) || '');
  if (id.endsWith('-64')) return true;
  const path = String((it && (it.path || it.Path)) || '').toLowerCase();
  if (contentKind === 'entertainment') {
    return (
      path.includes('entertainment') ||
      path.includes('things-to-do') ||
      path.includes('dining') ||
      path.includes('destinations') ||
      path.includes('events')
    );
  }
  return pathMentionsIndexablePath(path, contentKind);
}

function crawlRecordPathAllowed(contentKind, path, tcmId) {
  const p = String(path || '').toLowerCase();
  const id = String(tcmId || '');
  if (contentKind === 'entertainment') {
    return p.includes('entertainment') || id.endsWith('-64');
  }
  if (id.endsWith('-64')) return true;
  return pathMentionsIndexablePath(p, contentKind);
}

function usesEntertainmentCrawlRanking(contentKind) {
  return contentKind === 'entertainment';
}

function usesNonDiningIndexWarning(contentKind) {
  return !!contentKind && contentKind !== 'dining';
}

function nonDiningIndexWarningLabel(contentKind) {
  const label =
    contentKind === 'things-to-do'
      ? 'Things to do'
      : String(contentKind || 'non-dining')
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
  return (
    label +
    ' URL — EVO065/LGCY065 links may need a D-Scribe session search when the dining index has no row for this slug.'
  );
}

function folderPathSliceStart(parts) {
  const re = /entertainment|dining|destinations|destination|events|things-to-do/i;
  return parts.findIndex((p) => re.test(p));
}

module.exports = {
  VALIDATE_URL_ANCHORS,
  CMS_FOLDER_PATH_TOKENS,
  findUrlAnchor,
  validatePathHint,
  pathMentionsIndexablePath,
  pathMentionsIndexableItem,
  crawlRecordPathAllowed,
  usesEntertainmentCrawlRanking,
  usesNonDiningIndexWarning,
  nonDiningIndexWarningLabel,
  folderPathSliceStart
};

'use strict';

/**
 * CMS folder branches that mirror real facilities (replicas) — exclude from Validate
 * search, crawl ranking, and slug index builds.
 *
 * EVO065 Building Blocks → "Delete on August 31 WDW" → … → new-DO-NOT-PUBLISH / wdw
 */
const EXCLUDED_PATH_SUBSTRINGS = [
  'delete on august 31 wdw',
  'delete on august 31',
  'new-do-not-publish',
  'modified-do-not-publish',
  'do-not-publish'
];

function combinedPathText(recOrItem) {
  const path = String((recOrItem && (recOrItem.path || recOrItem.Path)) || '');
  const webdav = String((recOrItem && (recOrItem.webdav || recOrItem.WebDav)) || '');
  const title = String((recOrItem && (recOrItem.title || recOrItem.Title)) || '');
  const folderPath = String((recOrItem && recOrItem.folderPath) || '');
  return (path + ' ' + webdav + ' ' + title + ' ' + folderPath).toLowerCase();
}

function isExcludedCmsPath(recOrItem) {
  const combined = combinedPathText(recOrItem);
  if (/personalization/.test(combined)) return true;
  return EXCLUDED_PATH_SUBSTRINGS.some((s) => combined.includes(s));
}

module.exports = {
  EXCLUDED_PATH_SUBSTRINGS,
  combinedPathText,
  isExcludedCmsPath
};

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const core = require('./dining-resolve-core.js');
const { lookupSlugEntryLive } = require('./dscribe-live.js');
const { getCookie } = require('./dscribe-session.js');

function chainScore(slot) {
  if (!slot) return 0;
  let n = 0;
  if (slot.bbParentChain && slot.bbParentChain.length) n += 2;
  if (slot.pageParentChain && slot.pageParentChain.length) n += 2;
  return n;
}

function mergeSlot(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const out = Object.assign({}, existing);
  const bbIn = incoming.bbParentChain || [];
  const bbOut = out.bbParentChain || [];
  if (bbIn.length && (!bbOut.length || bbIn.length >= bbOut.length)) {
    out.bbParentChain = bbIn;
  }
  const pgIn = incoming.pageParentChain || [];
  const pgOut = out.pageParentChain || [];
  if (pgIn.length && (!pgOut.length || pgIn.length >= pgOut.length)) {
    out.pageParentChain = pgIn;
    out.pageTcm = incoming.pageTcm || out.pageTcm;
    out.itemNumber = incoming.itemNumber || out.itemNumber;
    out.pageTitle = incoming.pageTitle || out.pageTitle;
  }
  return out;
}

function mergeEntry(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const out = Object.assign({}, existing);
  out.displayName = incoming.displayName || out.displayName;
  ['evo040', 'evo065', 'lgcy065'].forEach((k) => {
    out[k] = mergeSlot(out[k], incoming[k]);
  });
  return out;
}

function needsEnrich(result) {
  if (!result || !result.ok) return false;
  // EVO065 publish (934) is the primary Validate target; skip crawl/live when it is facility-deep.
  if (result.evo065 && !result.evo065.note) return false;
  return ['evo040', 'evo065', 'lgcy065'].some((k) => {
    const block = result[k];
    return !!(block && block.note);
  });
}

function lookupFromCrawl(lookupKey) {
  const script = path.join(__dirname, 'build-dining-slug-index.py');
  const env = Object.assign({}, process.env);
  try {
    const stdout = execFileSync('python3', [script, '--lookup', lookupKey], {
      encoding: 'utf8',
      timeout: 180000,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const entry = JSON.parse(stdout.trim() || '{}');
    return Object.keys(entry).length ? entry : null;
  } catch (err) {
    return null;
  }
}

function applyEntryToResult(result, entry, links) {
  if (!entry) return result;
  const merged = mergeEntry(result._entry || {}, entry);
  result._entry = merged;
  result.displayName = merged.displayName || result.displayName;
  result.evo040 = core.categoryPayload(links, 'evo040', core.slotForPub(merged, 'evo040'));
  result.evo065 = core.categoryPayload(links, 'evo065', core.slotForPub(merged, 'evo065'));
  result.lgcy065 = core.categoryPayload(links, 'lgcy065', core.slotForPub(merged, 'lgcy065'));
  return result;
}

async function enrichResult(result, links) {
  if (!needsEnrich(result)) return result;

  const lookupKey = result.lookupKey || result.slug;
  const warnings = (result.warnings || []).slice();

  let entry = lookupFromCrawl(lookupKey);
  if (entry) {
    applyEntryToResult(result, entry, links);
    warnings.push('D-Scribe folder chains filled from local crawl (DSCRIBE_DATA).');
  }

  if (needsEnrich(result) && getCookie()) {
    const live = await lookupSlugEntryLive(result.slug, lookupKey);
    if (live.authFailed) {
      warnings.push('DScribe session expired — paste a fresh cookie in Validate → D-Scribe session.');
    } else if (live.entry) {
      applyEntryToResult(result, live.entry, links);
      warnings.push('D-Scribe folder chains filled via live CMS search.');
    } else if (live.error) {
      warnings.push(live.error);
    }
  } else if (needsEnrich(result) && !getCookie()) {
    warnings.push(
      'Facility-deep explorer links need a crawl index rebuild or a DScribe session cookie (Validate → D-Scribe session).'
    );
  }

  result.warnings = warnings;
  delete result._entry;
  return result;
}

function mergeIndexEntries(target, source) {
  if (!source) return target;
  Object.keys(source).forEach((k) => {
    target[k] = mergeEntry(target[k], source[k]);
  });
  return target;
}

module.exports = {
  mergeEntry,
  mergeIndexEntries,
  needsEnrich,
  enrichResult,
  lookupFromCrawl,
  chainScore
};

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const links = require('./dscribe-links.js');

const PUBLICATION_SCOPE = {
  evo040: { publishId: '281', sourcePubs: ['281', '501'] },
  evo065: { publishId: '934', sourcePubs: ['283', '934', '501'] },
  lgcy065: { publishId: '914', sourcePubs: ['627', '914'] }
};

const ROOT = path.join(__dirname, '..', '..');

function crawlPath() {
  const data = (process.env.DSCRIBE_DATA || '').trim();
  if (data) {
    const p = path.join(data, 'dscribe', 'crawl', 'items.jsonl');
    if (fs.existsSync(p)) return p;
  }
  const home = path.join(
    process.env.HOME || '',
    'Documents',
    'disney-dining-content-ops-full',
    'data',
    'dscribe',
    'crawl',
    'items.jsonl'
  );
  if (process.env.HOME && fs.existsSync(home)) return home;
  return null;
}

function pubFromTcm(tcmId) {
  if (!tcmId || !String(tcmId).startsWith('tcm:')) return '';
  return String(tcmId).split(':')[1].split('-')[0];
}

function parseJsonlLine(line) {
  const i = line.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(line.slice(i));
  } catch (_) {
    return null;
  }
}

const crawlRecordCache = new Map();

function rgLines(pattern, filePath) {
  const tries = [
    () =>
      execFileSync('rg', ['-i', '-F', pattern, filePath, '--no-heading'], {
        encoding: 'utf8',
        maxBuffer: 80 * 1024 * 1024
      }),
    () =>
      execFileSync('/usr/bin/grep', ['-i', '-F', pattern, filePath], {
        encoding: 'utf8',
        maxBuffer: 80 * 1024 * 1024
      })
  ];
  for (const run of tries) {
    try {
      return run();
    } catch (err) {
      if (err.stdout) return err.stdout;
    }
  }
  return '';
}

function loadCrawlById(ids) {
  const filePath = crawlPath();
  const byId = {};
  if (!filePath || !ids.length) return byId;
  for (const id of ids) {
    if (!id || byId[id]) continue;
    const body = String(id).split(':')[1] || '';
    if (!body) continue;
    const text = rgLines(body, filePath);
    text.split('\n').filter(Boolean).forEach((line) => {
      const rec = parseJsonlLine(line);
      if (rec && rec.id === id) byId[id] = rec;
    });
  }
  return byId;
}

function searchTerms(slug, displayName, urlSlug) {
  const terms = new Set([slug, displayName, urlSlug].filter(Boolean));
  if (displayName) terms.add(displayName.toLowerCase());
  slug.split('-').forEach((p) => {
    if (p.length > 3) terms.add(p);
  });
  if (/crown|musician|music/i.test(slug + ' ' + (urlSlug || ''))) {
    terms.add('rose-n-crown');
    terms.add('rose-n-Crown-pub-musician');
    terms.add('rose-n-crown-pub-musician');
  }
  if (urlSlug && urlSlug !== slug) {
    terms.add(urlSlug.replace(/-/g, ' '));
  }
  return [...terms];
}

function pageTitleMatchesUrlSlug(title, urlSlug) {
  if (!urlSlug || !title) return false;
  const t = String(title)
    .toLowerCase()
    .replace(/^page-/, '');
  const u = String(urlSlug).toLowerCase();
  if (t === u) return true;
  const strip = (s) => s.replace(/-music$/, '').replace(/-/g, '');
  return strip(t) === strip(u) || t.includes(u) || u.includes(t);
}

function collectCrawlRecords(slug, displayName, urlSlug) {
  const cacheKey = [slug, urlSlug || '', displayName || ''].join('\0');
  if (crawlRecordCache.has(cacheKey)) return crawlRecordCache.get(cacheKey);

  const filePath = crawlPath();
  const byId = {};
  if (!filePath) {
    crawlRecordCache.set(cacheKey, byId);
    return byId;
  }
  const terms = searchTerms(slug, displayName, urlSlug);
  for (const term of terms) {
    if (!term || term.length < 3) continue;
    rgLines(term, filePath)
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        const rec = parseJsonlLine(line);
        if (rec && rec.id) byId[rec.id] = rec;
      });
    if (Object.keys(byId).length >= 8) break;
  }
  crawlRecordCache.set(cacheKey, byId);
  return byId;
}

function folderPathLabel(rec) {
  const raw = String(rec.path || rec.webdav || '').trim();
  if (!raw) return '—';
  const parts = raw.split(/[/\\]/).filter(Boolean);
  const idx = parts.findIndex((p) => /entertainment|dining|events|things-to-do/i.test(p));
  const slice = idx >= 0 ? parts.slice(idx) : parts.slice(-5);
  return slice.join(' / ') || raw;
}

function matchRank(slug, displayName, rec, urlSlug) {
  const title = String(rec.title || '').toLowerCase();
  const slugL = slug.toLowerCase();
  const path = String(rec.path || rec.webdav || '').toLowerCase();
  if (/personalization/i.test(title) || path.includes('personalization')) {
    return { rank: 99, exact: false };
  }
  const id = String(rec.id || '');
  if (id.endsWith('-64') && pageTitleMatchesUrlSlug(rec.title, urlSlug)) {
    return { rank: 0, exact: true };
  }
  if (title === slugL || title === String(displayName || '').toLowerCase()) {
    return { rank: 0, exact: true };
  }
  if (path.includes('building blocks') && path.includes('entertainment') && /rose-n-crown|musician/.test(path)) {
    return { rank: 0, exact: id.endsWith('-2') };
  }
  if (title.includes(slugL) || path.includes(slugL)) return { rank: 1, exact: false };
  if (slugL.includes('music') && title.includes('musician')) return { rank: 2, exact: false };
  if (title.includes('page-') && slugL.replace(/-music$/, '').split('-').every((p) => p.length < 3 || title.includes(p))) {
    return { rank: 2, exact: false };
  }
  return { rank: 99, exact: false };
}

function allowedPubForItem(pubKey, tcmId, rec, contentKind) {
  const pub = pubFromTcm(tcmId);
  const scope = PUBLICATION_SCOPE[pubKey];
  if (!scope) return false;
  if (pub === '472') {
    if (!rec || contentKind !== 'entertainment') return false;
    const path = String(rec.path || rec.webdav || '').toLowerCase();
    return path.includes('building blocks') && path.includes('entertainment') && String(tcmId).endsWith('-2');
  }
  if (scope.sourcePubs.includes(pub)) return true;
  if (pubKey === 'evo040' && pub === '501') return true;
  if (pubKey === 'evo065' && pub === '501') return true;
  return false;
}

function walkParentChain(byId, startParent) {
  const chain = [];
  let cur = startParent;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const body = cur.split(':')[1] || '';
    if (body.endsWith('-3-4') || body.endsWith('-1-2')) break;
    chain.push(cur);
    let rec = byId[cur];
    if (!rec) {
      Object.assign(byId, loadCrawlById([cur]));
      rec = byId[cur];
    }
    if (!rec || !rec.parent) break;
    cur = rec.parent;
  }
  chain.reverse();
  return chain;
}

function explorerUrlForCrawlRecord(pubKey, rec, byId) {
  const id = rec.id;
  const publishId = PUBLICATION_SCOPE[pubKey].publishId;
  let parentChain = [];
  if (String(id).endsWith('-64') || String(id).endsWith('-4')) {
    parentChain = walkParentChain(byId, rec.parent);
    if (String(id).endsWith('-4')) parentChain = parentChain.concat([id]);
  } else if (String(id).endsWith('-2')) {
    parentChain = walkParentChain(byId, rec.parent).concat([id]);
  }
  const chain = parentChain.map((tcm) => links.remapTcmToPublishPub(tcm, publishId));
  if (String(id).endsWith('-64')) {
    const itemNum = parseInt(String(id).split(':')[1].split('-')[1], 10);
    if (links.pageFolderExplorer && chain.length && Number.isFinite(itemNum)) {
      return links.pageFolderExplorer(pubKey, parentChain, itemNum);
    }
  }
  if (chain.length) {
    const kind = String(id).endsWith('-2') ? 'bb' : 'root';
    if (kind === 'bb' && links.facilityBuildingBlocksExplorer) {
      return links.facilityBuildingBlocksExplorer(pubKey, parentChain);
    }
    if (links.facilityRootPageExplorer) {
      return links.facilityRootPageExplorer(pubKey, parentChain);
    }
  }
  return null;
}

function crawlCandidatesForPublication(pubKey, slug, displayName, urlSlug, contentKind, preloadedById) {
  const byId = preloadedById || collectCrawlRecords(slug, displayName, urlSlug);
  const ranked = [];
  Object.values(byId).forEach((rec) => {
    if (!rec.id || !allowedPubForItem(pubKey, rec.id, rec, contentKind)) return;
    const path = String(rec.path || rec.webdav || '').toLowerCase();
    if (contentKind === 'entertainment' && !path.includes('entertainment') && !String(rec.id).endsWith('-64')) {
      return;
    }
    const { rank, exact } = matchRank(slug, displayName, rec, urlSlug);
    if (rank >= 99) return;
    ranked.push({ rec, rank, exact });
  });
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (contentKind === 'entertainment') {
      const aPage = String(a.rec.title || '').toLowerCase().startsWith('page-') ? 0 : 1;
      const bPage = String(b.rec.title || '').toLowerCase().startsWith('page-') ? 0 : 1;
      if (aPage !== bPage) return aPage - bPage;
      const ap = String(a.rec.id).endsWith('-64') ? 0 : 1;
      const bp = String(b.rec.id).endsWith('-64') ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const aBb = String(a.rec.path || '').toLowerCase().includes('building blocks') ? 0 : 1;
      const bBb = String(b.rec.path || '').toLowerCase().includes('building blocks') ? 0 : 1;
      if (aBb !== bBb) return aBb - bBb;
      const ae = String(a.rec.path || '').toLowerCase().includes('entertainment') ? 0 : 1;
      const be = String(b.rec.path || '').toLowerCase().includes('entertainment') ? 0 : 1;
      if (ae !== be) return ae - be;
    }
    return a.exact === b.exact ? 0 : a.exact ? -1 : 1;
  });
  const candidates = [];
  const seenUrl = new Set();
  for (const row of ranked.slice(0, 15)) {
    const url = explorerUrlForCrawlRecord(pubKey, row.rec, byId);
    if (!url || seenUrl.has(url)) continue;
    seenUrl.add(url);
    const id = String(row.rec.id || '');
    let itemKind = 'other';
    if (id.endsWith('-64')) itemKind = 'page';
    else if (id.endsWith('-4')) itemKind = 'structure';
    else if (id.endsWith('-2')) itemKind = 'bb';
    candidates.push({
      name: String(row.rec.title || slug),
      folderPath: folderPathLabel(row.rec),
      explorerUrl: url,
      exact: row.exact,
      tcmId: row.rec.id,
      source: 'crawl',
      itemKind
    });
  }
  return candidates;
}

function augmentByIdWithEntertainmentBbFolders(byId, slug, urlSlug) {
  const filePath = crawlPath();
  if (!filePath) return byId;
  const out = byId || {};
  const patterns = new Set(['rose-n-crown-pub-musician', 'rose-n-Crown-pub-musician']);
  const slugL = String(slug || '').toLowerCase();
  if (slugL.includes('crown') || String(urlSlug || '').includes('crown')) {
    patterns.add('rose-n-crown');
  }
  slugL.split('-').forEach((p) => {
    if (p.length > 4 && /crown|music|musician/.test(p)) patterns.add(p);
  });
  for (const pattern of patterns) {
    rgLines(pattern, filePath)
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        const rec = parseJsonlLine(line);
        if (!rec || !rec.id || !String(rec.id).endsWith('-2')) return;
        const path = String(rec.path || rec.webdav || '').toLowerCase();
        if (!path.includes('building blocks') || !path.includes('entertainment')) return;
        out[rec.id] = rec;
      });
  }
  return out;
}

function entertainmentBuildingBlocksFromCrawl(byId, pubKey, slug, urlSlug) {
  if (!pubKey) return null;
  const mergedById = augmentByIdWithEntertainmentBbFolders(byId, slug, urlSlug);
  let best = null;
  let bestScore = 99;
  Object.values(mergedById).forEach((rec) => {
    if (!rec.id || pubFromTcm(rec.id) !== '472' || !String(rec.id).endsWith('-2')) return;
    const path = String(rec.path || rec.webdav || '').toLowerCase();
    if (!path.includes('building blocks') || !path.includes('entertainment')) return;
    if (/personalization/.test(path)) return;
    const title = String(rec.title || '').toLowerCase();
    const webdav = String(rec.webdav || '').toLowerCase();
    let score = 5;
    if (/media-player|\/assets(\/|$)/.test(webdav)) score += 8;
    if (title.includes('musician') || (title.includes('crown') && title.includes('pub'))) score = 1;
    if (webdav.includes('rose-n-crown-pub-musician/rose-n-crown-pub-musician')) score = -2;
    else if (path.includes('rose-n-crown') || path.includes('rose-n-crown-pub-musician')) score = 0;
    if (urlSlug && path.includes(String(urlSlug).toLowerCase().replace(/-music$/, ''))) {
      score = Math.min(score, 0);
    }
    if (score < bestScore || (score === bestScore && best && webdav.length > String(best.webdav || '').length)) {
      bestScore = score;
      best = rec;
    }
  });
  if (!best || bestScore >= 99) return null;
  const parentChain = walkParentChain(mergedById, best.parent).concat([best.id]);
  return links.facilityBuildingBlocksExplorer(pubKey, parentChain);
}

function collectCrawlRecordsForResolve(slug, displayName, urlSlug) {
  return collectCrawlRecords(slug, displayName, urlSlug);
}

module.exports = {
  crawlCandidatesForPublication,
  crawlPath,
  collectCrawlRecordsForResolve,
  entertainmentBuildingBlocksFromCrawl,
  pageTitleMatchesUrlSlug
};

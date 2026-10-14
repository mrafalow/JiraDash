'use strict';

const links = require('./dscribe-links.js');
const { getCookie, DSCRIBE_BASE } = require('./dscribe-session.js');

/** US All publish publications only (config table). */
const PUBLICATION_SCOPE = {
  evo040: { publishId: '281', sourcePubs: ['281', '501'], label: 'EVO040 WDW (en) Content' },
  evo065: { publishId: '934', sourcePubs: ['283', '934', '501'], label: 'EVO065 WDW Parent (All) Publish' },
  lgcy065: { publishId: '914', sourcePubs: ['627', '914'], label: 'LGCY065 Parent (All) Publish' }
};

const BLOCKED_PUB_PREFIXES = new Set(['472', '285', '286']);
const { crawlCandidatesForPublication } = require('./dscribe-crawl-search.js');

function pubFromTcm(tcmId) {
  if (!tcmId || !String(tcmId).startsWith('tcm:')) return '';
  return String(tcmId).split(':')[1].split('-')[0];
}

function normalizeToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function matchRank(querySlug, queryTitle, item) {
  const slug = normalizeToken(querySlug);
  const title = String(item.title || item.Title || '').trim();
  const titleNorm = normalizeToken(title);
  const titleSlug = normalizeToken(title.replace(/\s+/g, '-'));
  if (!slug) return { rank: 99, exact: false };
  if (queryTitle && titleNorm === normalizeToken(queryTitle)) return { rank: 0, exact: true };
  if (titleSlug === slug || titleNorm === slug) return { rank: 0, exact: true };
  if (titleSlug.startsWith(slug) || slug.startsWith(titleSlug)) return { rank: 1, exact: false };
  if (titleNorm.includes(slug) || slug.includes(titleNorm)) return { rank: 2, exact: false };
  if (title.toLowerCase().includes(slug.replace(/-/g, ' '))) return { rank: 3, exact: false };
  const parts = slug.split('-').filter((p) => p.length > 2);
  if (parts.length >= 2) {
    const hit = parts.filter((p) => titleNorm.includes(p)).length;
    if (hit >= Math.max(2, parts.length - 1)) return { rank: 3, exact: false };
  }
  return { rank: 99, exact: false };
}

function folderPathLabel(item) {
  const raw = String(item.path || item.Path || item.webdav || item.WebDav || '').trim();
  if (!raw) return '—';
  const parts = raw.split(/[/\\]/).filter(Boolean);
  const idx = parts.findIndex((p) => /wdw|world/i.test(p));
  const slice = idx >= 0 ? parts.slice(idx + 1) : parts.slice(-6);
  return slice.join(' / ') || raw;
}

function pathMentionsIndexable(it, contentKind) {
  const id = String(it.id || it.Id || '');
  if (id.endsWith('-64')) return true;
  const path = String(it.path || it.Path || '').toLowerCase();
  if (contentKind === 'entertainment') {
    return path.includes('entertainment') || path.includes('things-to-do') || path.includes('dining');
  }
  return (
    path.includes('dining') ||
    path.includes('entertainment') ||
    path.includes('events') ||
    path.includes('things-to-do')
  );
}

async function fetchJson(path, cookie) {
  const res = await fetch(DSCRIBE_BASE + path, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
      'request-client': 'experience-space',
      'x-csrf': '1'
    }
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

function tcmToApiPath(tcmId) {
  if (!tcmId || !tcmId.startsWith('tcm:')) return null;
  return '/ui/api/v3.0/items/' + tcmId.replace(':', '_');
}

async function walkParentChain(cookie, startParent) {
  const chain = [];
  let cur = startParent;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const body = cur.split(':')[1] || '';
    if (body.endsWith('-3-4') || body.endsWith('-1-2')) break;
    chain.push(cur);
    const detail = await fetchJson(tcmToApiPath(cur), cookie);
    const parent = detail && (detail.parent || detail.Parent || detail.parentId);
    if (!parent) break;
    const pbody = String(parent).split(':')[1] || '';
    if (pbody.endsWith('-3-4') || pbody.endsWith('-1-2')) break;
    cur = parent;
  }
  chain.reverse();
  return chain;
}

function itemsFromSearchPayload(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return (
    data.items ||
    data.Items ||
    data.results ||
    data.hits ||
    (data.result && data.result.items) ||
    []
  );
}

async function searchItemsGlobal(cookie, slug) {
  const titleGuess = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const queries = [slug, 'Title:' + slug, titleGuess];
  const out = [];
  const seen = new Set();

  function collect(data) {
    const items = itemsFromSearchPayload(data);
    for (const it of items) {
      const id = it.id || it.Id || it.uri;
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(it);
      }
    }
  }

  for (const q of queries) {
    collect(
      await fetchJson(
        '/ui/api/v3.0/system/search?fullTextQuery=' + encodeURIComponent(q) + '&resultLimit=80',
        cookie
      )
    );
    if (out.length) break;
    collect(
      await fetchJson(
        '/ui/api/v3.0/search?searchQuery=' + encodeURIComponent(q) + '&maxResults=200',
        cookie
      )
    );
    if (out.length) break;
  }
  return out;
}

function itemAllowedInScope(pubKey, item) {
  const id = item.id || item.Id;
  if (!id) return false;
  const pub = pubFromTcm(id);
  if (BLOCKED_PUB_PREFIXES.has(pub)) return false;
  const scope = PUBLICATION_SCOPE[pubKey];
  if (!scope) return false;
  return scope.sourcePubs.includes(pub);
}

function explorerUrlForItem(pubKey, item, parentChain) {
  const scope = PUBLICATION_SCOPE[pubKey];
  if (!scope) return null;
  const id = item.id || item.Id;
  const publishId = scope.publishId;
  const chain = (parentChain || []).map((tcm) => links.remapTcmToPublishPub(tcm, publishId));
  const remappedItem = links.remapTcmToPublishPub(id, publishId);
  if (String(id).endsWith('-64')) {
    const itemNum = parseInt(String(id).split(':')[1].split('-')[1], 10);
    if (links.pageFolderExplorer && chain.length && Number.isFinite(itemNum)) {
      return links.pageFolderExplorer(pubKey, chain, itemNum);
    }
  }
  if (chain.length) {
    return links.explorerWithItem(publishId, chain, remappedItem);
  }
  return null;
}

function searchQueriesForSlug(slug, displayName, contentKind) {
  const queries = [slug, displayName];
  if (displayName) {
    queries.push(displayName.replace(/\s+/g, ' ').trim());
    queries.push('Title:' + displayName.replace(/\s+/g, ' ').trim());
  }
  if (contentKind === 'entertainment') {
    queries.push(slug.replace(/-/g, ' '));
    queries.push(
      slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    );
  }
  return [...new Set(queries.filter(Boolean))];
}

async function searchCandidatesForPublication(
  pubKey,
  slug,
  displayName,
  cookie,
  extraQueries,
  contentKind,
  crawlById
) {
  const scope = PUBLICATION_SCOPE[pubKey];
  if (!scope) {
    return { candidates: [], error: 'Unknown publication.' };
  }

  const items = [];
  const seen = new Set();
  if (cookie) {
    const uniqQ = searchQueriesForSlug(slug, displayName, contentKind).concat(extraQueries || []);
    for (const q of [...new Set(uniqQ.filter(Boolean))]) {
      const batch = await searchItemsGlobal(cookie, q);
      for (const it of batch) {
        const id = it.id || it.Id;
        if (id && !seen.has(id)) {
          seen.add(id);
          items.push(it);
        }
      }
    }
  }
  const ranked = [];
  for (const it of items) {
    if (!itemAllowedInScope(pubKey, it)) continue;
    if (!pathMentionsIndexable(it, contentKind)) continue;
    const { rank, exact } = matchRank(slug, displayName, it);
    if (rank >= 99) continue;
    ranked.push({ it, rank, exact });
  }

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return String(a.it.title || '').localeCompare(String(b.it.title || ''));
  });

  const candidates = [];
  for (const row of ranked.slice(0, 12)) {
    const it = row.it;
    const id = it.id || it.Id;
    let parentChain = [];
    if (String(id).endsWith('-64') || String(id).endsWith('-4')) {
      const parent = it.parent || it.Parent;
      parentChain = await walkParentChain(cookie, parent);
      if (String(id).endsWith('-4')) parentChain = parentChain.concat([id]);
    }
    const explorerUrl = explorerUrlForItem(pubKey, it, parentChain);
    if (!explorerUrl) continue;
    candidates.push({
      name: String(it.title || it.Title || slug),
      folderPath: folderPathLabel(it),
      explorerUrl,
      exact: row.exact,
      tcmId: id
    });
  }

  let merged = candidates.slice();
  if (!merged.length) {
    merged = crawlCandidatesForPublication(
      pubKey,
      slug,
      displayName,
      (extraQueries && extraQueries[0]) || slug,
      contentKind,
      crawlById
    );
  }

  return {
    candidates: merged,
    error: merged.length ? null : 'No matches in this publication (live search + crawl).'
  };
}

function blockHasFacilityDepth(block) {
  if (!block) return false;
  if (typeof block.pageChainDepth === 'number' && block.pageChainDepth > 0) return true;
  const u = (block.buildingBlocksUrl || '') + (block.rootPageLevelUrl || '');
  if (!u || u.includes('0-472-1')) return false;
  return /0-(281|934|914)-1_tcm:(281|934|914)-(?:1-2|3-4)_tcm:(281|934|914)-\d+-/.test(u);
}

function publicationHasExactMatch(pubKey, block, contentKind) {
  if (!blockHasFacilityDepth(block)) return false;
  if (contentKind === 'entertainment') {
    if (pubKey === 'evo065' || pubKey === 'lgcy065') {
      return (block.pageChainDepth || 0) > 0;
    }
    if (pubKey === 'evo040') {
      return (block.pageChainDepth || 0) > 0 || !!(block.buildingBlocksUrl && block.rootPageLevelUrl);
    }
  }
  return true;
}

function promotePrimaryFromCandidates(block, pubKey, contentKind, indexSlug, urlSlug, crawlById) {
  const list = block.candidates || [];
  const crawlMod = require('./dscribe-crawl-search.js');

  if (!block.rootPageLevelUrl && pubKey !== 'evo040' && list.length) {
    const pages = list.filter((c) => String(c.tcmId || '').endsWith('-64'));
    const ranked = pages.slice().sort((a, b) => {
      const aPage = String(a.name || '').toLowerCase().startsWith('page-') ? 0 : 1;
      const bPage = String(b.name || '').toLowerCase().startsWith('page-') ? 0 : 1;
      if (aPage !== bPage) return aPage - bPage;
      const aUrl = crawlMod.pageTitleMatchesUrlSlug(a.name, urlSlug) ? 0 : 1;
      const bUrl = crawlMod.pageTitleMatchesUrlSlug(b.name, urlSlug) ? 0 : 1;
      if (aUrl !== bUrl) return aUrl - bUrl;
      return a.exact === b.exact ? 0 : a.exact ? -1 : 1;
    });
    const bestPage = ranked[0];
    if (bestPage) {
      block.rootPageLevelUrl = bestPage.explorerUrl;
      block.pageChainDepth = Math.max(block.pageChainDepth || 0, 1);
    }
  }

  if (!block.buildingBlocksUrl && pubKey !== 'lgcy065') {
    let bbUrl = null;
    if (contentKind === 'entertainment' && crawlById) {
      bbUrl = crawlMod.entertainmentBuildingBlocksFromCrawl(crawlById, pubKey, indexSlug, urlSlug);
    }
    if (!bbUrl && list.length) {
      const bbCands = list.filter(
        (c) =>
          c.itemKind === 'bb' ||
          (String(c.tcmId || '').endsWith('-2') && !/personalization/i.test(String(c.name)))
      );
      const best =
        bbCands.find((c) => /entertainment/.test(String(c.folderPath || '').toLowerCase())) ||
        bbCands[0];
      if (best) bbUrl = best.explorerUrl;
    }
    if (bbUrl) block.buildingBlocksUrl = bbUrl;
  }
}

async function attachScopedSearchToResult(result) {
  if (!result || !result.ok) return result;
  const cookie = getCookie();
  const slug = result.indexSlug || result.slug;
  const urlSlug = result.slug;
  const displayName = result.displayName || slug;
  const contentKind = result.contentKind || 'dining';
  const crawlMod = require('./dscribe-crawl-search.js');
  let crawlById = null;

  for (const pubKey of ['evo040', 'evo065', 'lgcy065']) {
    const block = result[pubKey];
    if (!block) continue;
    const hasFacility = publicationHasExactMatch(pubKey, block, contentKind);
    if (hasFacility) {
      block.confidence = 'exact';
      continue;
    }
    block.confidence = 'none';
    block.buildingBlocksUrl = null;
    block.rootPageLevelUrl = null;
    if (!crawlById && crawlMod.collectCrawlRecordsForResolve) {
      crawlById = crawlMod.collectCrawlRecordsForResolve(slug, displayName, result.slug);
    }
    const extra = [result.slug, result.slug && result.slug.replace(/-/g, ' ')].filter(
      (q) => q && q !== slug
    );
    const search = await searchCandidatesForPublication(
      pubKey,
      slug,
      displayName,
      cookie,
      extra,
      contentKind,
      crawlById
    );
    block.candidates = search.candidates;
    if (contentKind === 'entertainment' && crawlById) {
      promotePrimaryFromCandidates(block, pubKey, contentKind, slug, urlSlug, crawlById);
      const primaryUrls = new Set(
        [block.buildingBlocksUrl, block.rootPageLevelUrl].filter(Boolean)
      );
      block.candidates = (block.candidates || []).filter((c) => !primaryUrls.has(c.explorerUrl));
    }
    if (search.candidates.length) {
      const fromCrawl = search.candidates.some((c) => c.source === 'crawl');
      block.note = fromCrawl
        ? 'Matches from offline crawl (DSCRIBE_DATA) — primary links use best page / Building Blocks when found.'
        : 'No indexed facility folder — pick a match below (verify partial matches).';
    } else {
      block.note =
        search.error ||
        'No matches — set DSCRIBE_DATA to your crawl folder or save a D-Scribe session.';
    }
  }
  return result;
}

module.exports = {
  PUBLICATION_SCOPE,
  searchCandidatesForPublication,
  attachScopedSearchToResult,
  blockHasFacilityDepth,
  publicationHasExactMatch
};

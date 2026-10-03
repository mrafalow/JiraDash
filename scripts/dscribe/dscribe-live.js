'use strict';

const { DSCRIBE_BASE, getCookie } = require('./dscribe-session.js');

const PUB_SLOTS = {
  '281': 'evo040',
  '472': 'evo040',
  '283': 'evo065',
  '627': 'lgcy065'
};

function apiHeaders(cookie) {
  return {
    Cookie: cookie,
    Accept: 'application/json',
    'request-client': 'experience-space',
    'x-csrf': '1'
  };
}

function tcmToApiPath(tcmId) {
  if (!tcmId || !tcmId.startsWith('tcm:')) return null;
  return '/ui/api/v3.0/items/' + tcmId.replace(':', '_');
}

async function fetchJson(path, cookie) {
  const res = await fetch(DSCRIBE_BASE + path, { method: 'GET', headers: apiHeaders(cookie) });
  if (res.status === 401 || res.status === 403) {
    const err = new Error('DScribe auth failed (HTTP ' + res.status + ')');
    err.status = res.status;
    throw err;
  }
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function searchItems(cookie, slug) {
  const queries = [
    'Title:' + slug,
    slug
  ];
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    const path =
      '/ui/api/v3.0/search?searchQuery=' +
      encodeURIComponent(q) +
      '&maxResults=200';
    const data = await fetchJson(path, cookie);
    const items = (data && (data.items || data.Items || data.results)) || [];
    for (const it of items) {
      const id = it.id || it.Id || it.uri;
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(it);
      }
    }
    if (out.length) break;
  }
  return out;
}

function pubFromTcm(tcmId) {
  if (!tcmId || !String(tcmId).startsWith('tcm:')) return '';
  return String(tcmId).split(':')[1].split('-')[0];
}

function slugFromItem(it) {
  const title = (it.title || it.Title || '').trim();
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(title)) return title.toLowerCase();
  return null;
}

function pathMentionsDining(it) {
  const path = String(it.path || it.Path || '').toLowerCase();
  return path.includes('dining');
}

async function walkParentChain(cookie, startParent, stopSuffixes) {
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

function emptySlot() {
  return {
    pageTcm: null,
    itemNumber: null,
    pageTitle: null,
    bbParentChain: [],
    pageParentChain: []
  };
}

/**
 * Live CMS search + parent walk for one dining slug (fallback when index/crawl miss).
 */
async function lookupSlugEntryLive(slug, lookupKey) {
  const cookie = getCookie();
  if (!cookie) return { entry: null, error: 'No DScribe cookie on server.' };

  let items;
  try {
    items = await searchItems(cookie, slug);
  } catch (err) {
    return { entry: null, error: err.message, authFailed: err.status === 401 || err.status === 403 };
  }

  const entry = {
    slug,
    parkSegment: lookupKey && lookupKey.includes('/') ? lookupKey.split('/')[0] : '',
    displayName: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    evo040: null,
    evo065: null,
    lgcy065: null
  };

  for (const it of items) {
    const id = it.id || it.Id;
    if (!id || !String(id).startsWith('tcm:')) continue;
    const pub = pubFromTcm(id);
    const tree = PUB_SLOTS[pub];
    if (!tree) continue;
    const itemSlug = slugFromItem(it);
    if (itemSlug !== slug) continue;

    if (!entry[tree]) entry[tree] = emptySlot();
    const slot = entry[tree];

    if (String(id).endsWith('-64') && pathMentionsDining(it)) {
      if (!slot.pageParentChain.length) {
        slot.pageTcm = id;
        slot.pageTitle = it.title || it.Title || slug;
        const parent = it.parent || it.Parent;
        slot.pageParentChain = await walkParentChain(cookie, parent, ['-3-4', '-1-2']);
      }
    }
    if (String(id).endsWith('-2')) {
      const body = id.split(':')[1] || '';
      if (body.endsWith('-1-2')) continue;
      if (!slot.bbParentChain.length) {
        const parent = it.parent || it.Parent;
        const ancestors = await walkParentChain(cookie, parent, ['-3-4', '-1-2']);
        slot.bbParentChain = ancestors.concat([id]);
      }
    }
  }

  const hasData = ['evo040', 'evo065', 'lgcy065'].some((k) => {
    const s = entry[k];
    return s && (s.bbParentChain.length || s.pageParentChain.length);
  });

  return { entry: hasData ? entry : null, error: hasData ? null : 'No facility folders found in DScribe search.' };
}

module.exports = { lookupSlugEntryLive, validateCookie: require('./dscribe-session.js').validateCookie };

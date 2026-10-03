'use strict';

const fs = require('fs');
const path = require('path');
const links = require('./dscribe-links.js');

const ROOT = path.join(__dirname, '..', '..');
const MAX_NODES = 280;
const MAX_DEPTH = 8;

let crawlCache = null;
let crawlSignature = '';
let roleCache = null;
let roleSignature = '';

const ROLE_RANK = {
  meta: 10,
  link: 20,
  urlFriendly: 25,
  internal: 28,
  esr: 30,
  detail: 40,
  finder: 45,
  mobile: 48,
  entityCard: 50,
  media: 60,
  other: 90
};

const OVERLAY_TO_ROLE = {
  meta: 'meta',
  url_friendly: 'urlFriendly',
  link: 'link',
  link_dining: 'link',
  esr: 'esr',
  finder: 'finder',
  short_description: 'detail',
  short_description_mobile: 'mobile',
  entity_card: 'entityCard',
  media: 'media',
  internal: 'internal'
};

const TYPE_RANK = { Folder: 1, StructureGroup: 2, Page: 3, RoleGroup: 3, Component: 4 };

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

function roleIndexPath() {
  const local = path.join(ROOT, 'data', 'component-role-by-id.json');
  if (fs.existsSync(local)) return local;
  const data = (process.env.DSCRIBE_DATA || '').trim();
  if (data) {
    const p = path.join(data, 'dscribe', 'component-role-by-id.json');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadComponentRoles() {
  const p = roleIndexPath();
  const signature = p ? p + ':' + fs.statSync(p).mtimeMs : 'missing';
  if (roleCache && signature === roleSignature) return roleCache;
  roleSignature = signature;
  if (!p) {
    roleCache = new Map();
    return roleCache;
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  roleCache = new Map(Object.entries(raw.roles || {}));
  return roleCache;
}

function inferNodeType(tcmId, rec) {
  const t = rec && rec.type;
  if (t) return t;
  const body = String(tcmId).split(':')[1] || '';
  if (body.startsWith('grp:')) return 'RoleGroup';
  if (body.endsWith('-64')) return 'Page';
  if (body.endsWith('-4')) return 'StructureGroup';
  if (body.endsWith('-2')) return 'Folder';
  return 'Component';
}

function componentGroup(title) {
  const t = String(title || '').toLowerCase();
  if (t.startsWith('meta-')) return 'meta';
  if (t.startsWith('link-dining-') || t.startsWith('link-')) return 'link';
  if (t.startsWith('internal-')) return 'internal';
  if (t.startsWith('esr-')) return 'esr';
  if (t.startsWith('finder')) return 'finder';
  if (t.startsWith('wdwdetail') || t.startsWith('wdwdetail-')) return 'detail';
  if (t.startsWith('entitycard')) return 'entityCard';
  if (t === 'media-player' || t === 'assets') return 'media';
  return 'other';
}

function effectiveRole(tcmId, title, overlayMap) {
  const fromTitle = componentGroup(title);
  if (fromTitle !== 'other') return fromTitle;
  const ov = overlayMap.get(tcmId);
  if (ov && OVERLAY_TO_ROLE[ov]) return OVERLAY_TO_ROLE[ov];
  return 'other';
}

function loadCrawl() {
  const p = crawlPath();
  const signature = p ? p + ':' + fs.statSync(p).mtimeMs : 'missing';
  if (crawlCache && signature === crawlSignature) return crawlCache;
  crawlSignature = signature;
  if (!p) {
    crawlCache = { ok: false, error: 'Crawl not found. Set DSCRIBE_DATA to dining-content-ops data.' };
    return crawlCache;
  }
  const byId = new Map();
  const children = new Map();
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      const id = rec.id;
      if (!id) continue;
      byId.set(id, rec);
      const parent = rec.parent;
      if (parent) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(id);
      }
    } catch (_) {
      /* skip bad line */
    }
  }
  crawlCache = { ok: true, byId, children, path: p };
  return crawlCache;
}

function pubFromTcm(tcmId) {
  return String(tcmId).split(':')[1].split('-')[0];
}

function explorerForRecord(rec, tcmId) {
  const pub = pubFromTcm(tcmId);
  const body = tcmId.split(':')[1] || '';
  if (body.endsWith('-64')) {
    const num = parseInt(body.split('-')[1], 10);
    if (pub === '283') return links.pageFolderExplorer('evo065', [], num);
    return links.editorPageUrl(pub, num);
  }
  if (body.endsWith('-2') || body.endsWith('-4')) {
    return null;
  }
  const item = 'tcm:' + pub + '-' + body.split('-')[1];
  return links.DSCRIBE_BASE + '/ui/editor/component?item=' + encodeURIComponent(item);
}

function sortedChildIds(ctx, parentId, lane) {
  const kids = ctx.children.get(parentId) || [];
  return kids.slice().sort((a, b) => {
    const ra = ctx.byId.get(a);
    const rb = ctx.byId.get(b);
    const ta = inferNodeType(a, ra);
    const tb = inferNodeType(b, rb);
    const tr = (TYPE_RANK[ta] || 5) - (TYPE_RANK[tb] || 5);
    if (tr !== 0) return tr;
    if (lane === 'bb' && ta === 'Component' && tb === 'Component') {
      const roleA = effectiveRole(a, ra && ra.title, ctx.overlayRoles);
      const roleB = effectiveRole(b, rb && rb.title, ctx.overlayRoles);
      const rr = (ROLE_RANK[roleA] || 99) - (ROLE_RANK[roleB] || 99);
      if (rr !== 0) return rr;
    }
    const titleA = (ra && ra.title) || a;
    const titleB = (rb && rb.title) || b;
    return String(titleA).localeCompare(String(titleB));
  });
}

function chainLeaf(chain) {
  return chain && chain.length ? chain[chain.length - 1] : null;
}

function maybeAddClickable(ctx, tcmId, bucket) {
  if (bucket.length >= MAX_NODES || ctx.seen.has(tcmId)) return;
  const rec = ctx.byId.get(tcmId);
  if (!rec) return;
  const url = explorerForRecord(rec, tcmId);
  if (!url) return;
  ctx.seen.add(tcmId);
  const title = rec.title || tcmId;
  const nt = inferNodeType(tcmId, rec);
  const role = nt === 'Component' ? effectiveRole(tcmId, title, ctx.overlayRoles) : nt;
  bucket.push({
    id: tcmId,
    label: title,
    nodeType: nt,
    group: role,
    sortRole: role,
    publication: rec.publication || '',
    explorerUrl: url
  });
}

function collectClickablesUnder(ctx, rootId, depth, bucket) {
  if (!rootId || depth > MAX_DEPTH || bucket.length >= MAX_NODES) return;
  const kids = sortedChildIds(ctx, rootId, 'bb');
  for (const kid of kids) {
    maybeAddClickable(ctx, kid, bucket);
    const rec = ctx.byId.get(kid);
    const nt = inferNodeType(kid, rec);
    if (nt === 'Folder' || nt === 'StructureGroup' || nt === 'Page') {
      collectClickablesUnder(ctx, kid, depth + 1, bucket);
    }
  }
}

function layoutClickableNodes(items) {
  items.sort((a, b) => {
    const ra = ROLE_RANK[a.sortRole] || 99;
    const rb = ROLE_RANK[b.sortRole] || 99;
    if (ra !== rb) return ra - rb;
    return String(a.label).localeCompare(String(b.label));
  });
  return items.map((item, i) => ({
    ...item,
    lane: 'links',
    depth: 0,
    x: 320,
    y: 48 + i * 34
  }));
}

function buildOfflineFacilityGraph(entry, meta) {
  const crawl = loadCrawl();
  if (!crawl.ok) {
    return { ok: false, error: crawl.error };
  }

  const evo065 = entry && entry.evo065;
  const evo040 = entry && entry.evo040;
  const pageChain = (evo065 && evo065.pageParentChain) || [];
  const bbChain = (evo040 && evo040.bbParentChain) || (evo065 && evo065.bbParentChain) || [];

  if (!pageChain.length && !bbChain.length) {
    return {
      ok: false,
      error: 'No structure or Building Blocks chains in index for this facility. Rebuild dining-slug-index.json from crawl.'
    };
  }

  const overlayRoles = loadComponentRoles();

  const ctx = {
    byId: crawl.byId,
    children: crawl.children,
    overlayRoles,
    seen: new Set()
  };

  const bucket = [];
  const structureLeaf = chainLeaf(pageChain);
  const bbLeaf = chainLeaf(bbChain);

  if (structureLeaf) collectClickablesUnder(ctx, structureLeaf, 0, bucket);
  if (evo065 && evo065.pageTcm) maybeAddClickable(ctx, evo065.pageTcm, bucket);
  if (bbLeaf) collectClickablesUnder(ctx, bbLeaf, 0, bucket);

  const nodes = layoutClickableNodes(bucket);

  return {
    ok: true,
    mode: 'offline',
    view: 'dscribe-links',
    displayName: meta.displayName,
    slug: meta.slug,
    lookupKey: meta.lookupKey,
    nodeCount: nodes.length,
    edgeCount: 0,
    rolesIndexed: overlayRoles.size,
    truncated: nodes.length >= MAX_NODES,
    nodes,
    edges: [],
    legend: {
      hint: 'Use Open beside each name to launch D-Scribe (sorted by component role, then title)'
    }
  };
}

module.exports = {
  loadCrawl,
  loadComponentRoles,
  buildOfflineFacilityGraph,
  crawlPath,
  roleIndexPath
};

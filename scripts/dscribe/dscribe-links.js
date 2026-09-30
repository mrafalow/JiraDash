'use strict';

const DSCRIBE_BASE = 'https://dpep-dscribe-production.tridion.sdlproducts.com';

/** Parent publish publications (WDW). */
const PUBLISH_PUBS = {
  evo065: {
    id: '934',
    label: 'EVO065 WDW Parent (All) Publish',
    structureSourcePub: '283'
  },
  lgcy065: {
    id: '914',
    label: 'LGCY065 Parent (All) Publish',
    structureSourcePub: '627'
  }
};

const ROOT_FOLDER_SUFFIX = '3-4';
const BUILDING_BLOCKS_SUFFIX = '1-2';

function explorerContainerUrl(pubId, folderTcmSegments) {
  const parts = ['cme:publications_tcm:0-' + pubId + '-1'];
  (folderTcmSegments || []).forEach((seg) => parts.push(seg));
  return (
    DSCRIBE_BASE +
    '/ui/explorer?container=' +
    parts.join('_') +
    '&panel=information'
  );
}

function explorerWithItem(pubId, folderChainPublish, itemTcmPublish) {
  const parts = ['cme:publications_tcm:0-' + pubId + '-1'];
  (folderChainPublish || []).forEach((seg) => parts.push(seg));
  let url =
    DSCRIBE_BASE + '/ui/explorer?container=' + parts.join('_') + '&panel=information';
  if (itemTcmPublish) {
    url += '&item=' + encodeURIComponent(itemTcmPublish);
  }
  return url;
}

function remapTcmToPublishPub(tcmId, publishPubId) {
  if (!tcmId || !publishPubId) return tcmId;
  const body = tcmId.split(':')[1] || '';
  const parts = body.split('-');
  if (parts.length < 2) return tcmId;
  if (parts.length >= 3) return 'tcm:' + publishPubId + '-' + parts[1] + '-' + parts[2];
  return 'tcm:' + publishPubId + '-' + parts[1];
}

function publicationRootExplorer(pubKey) {
  const pub = PUBLISH_PUBS[pubKey];
  if (!pub) return null;
  return explorerContainerUrl(pub.id, ['tcm:' + pub.id + '-' + ROOT_FOLDER_SUFFIX]);
}

function publicationBuildingBlocksExplorer(pubKey) {
  const pub = PUBLISH_PUBS[pubKey];
  if (!pub) return null;
  return explorerContainerUrl(pub.id, ['tcm:' + pub.id + '-' + BUILDING_BLOCKS_SUFFIX]);
}

function editorPageUrl(publishPubId, itemNumber) {
  const item = 'tcm:' + publishPubId + '-' + itemNumber + '-64';
  return (
    DSCRIBE_BASE +
    '/ui/editor/page?activeItem=' +
    encodeURIComponent(item) +
    '&item=' +
    encodeURIComponent(item) +
    '&tab=general.constraints'
  );
}

/**
 * Build publish-layer folder explorer for a structure page.
 * @param {'evo065'|'lgcy065'} pubKey
 * @param {string[]} ancestorChainStructure - tcm ids from crawl (283 or 627 pub)
 * @param {number} itemNumber - page item number
 */
function pageFolderExplorer(pubKey, ancestorChainStructure, itemNumber) {
  const pub = PUBLISH_PUBS[pubKey];
  if (!pub || !itemNumber) return null;
  const chain = ['tcm:' + pub.id + '-' + ROOT_FOLDER_SUFFIX];
  (ancestorChainStructure || []).forEach((id) => {
    chain.push(remapTcmToPublishPub(id, pub.id));
  });
  const itemTcm = 'tcm:' + pub.id + '-' + itemNumber + '-64';
  return explorerWithItem(pub.id, chain, itemTcm);
}

function titleCaseSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeProdUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { error: 'Paste a URL first.' };
  let u;
  try {
    u = new URL(trimmed);
  } catch (_) {
    return { error: 'Invalid URL.' };
  }
  const host = u.hostname.toLowerCase();
  if (!host.includes('disney.go.com')) {
    return { error: 'Expected a disney.go.com URL (v1: WDW dining).' };
  }
  u.search = '';
  u.hash = '';
  let path = u.pathname;
  if (!path.endsWith('/')) path += '/';
  const segments = path.split('/').filter(Boolean);
  const diningIdx = segments.indexOf('dining');
  if (diningIdx < 0) {
    return { error: 'URL path should include /dining/…' };
  }
  const after = segments.slice(diningIdx + 1);
  if (!after.length) {
    return { error: 'Missing facility slug after /dining/.' };
  }
  const slug = after[after.length - 1];
  const parkSegment = after.length > 1 ? after[0] : '';
  const lookupKey = parkSegment ? parkSegment + '/' + slug : slug;
  return {
    prodUrl: u.toString(),
    slug,
    parkSegment,
    lookupKey,
    pathAfterDining: after.join('/')
  };
}

function stageUrlFromProd(prodUrl, localePrefix) {
  const u = new URL(prodUrl);
  const host = u.hostname;
  if (host.startsWith('stage.')) return u.toString();
  u.hostname = 'stage.' + host;
  if (localePrefix) {
    const seg = localePrefix.replace(/^\/+|\/+$/g, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== seg) {
      u.pathname = '/' + seg + u.pathname;
    }
  }
  return u.toString();
}

const api = {
  DSCRIBE_BASE,
  PUBLISH_PUBS,
  explorerContainerUrl,
  explorerWithItem,
  remapTcmToPublishPub,
  publicationRootExplorer,
  publicationBuildingBlocksExplorer,
  editorPageUrl,
  pageFolderExplorer,
  titleCaseSlug,
  normalizeProdUrl,
  stageUrlFromProd
};

if (typeof module === 'object' && module.exports) {
  module.exports = api;
} else if (typeof globalThis !== 'undefined') {
  globalThis.DScribeLinks = api;
}

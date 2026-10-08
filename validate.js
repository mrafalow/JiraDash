/* Inline D-Scribe resolver (sync with scripts/dscribe/*) — always available in browser */
(function(){
  'use strict';
  if(globalThis.ValidateResolverInline) return;
  const DSCRIBE_BASE = 'https://dpep-dscribe-production.tridion.sdlproducts.com';
  const PUBLISH_PUBS = {
    evo040: { id: '281', structureSourcePub: '281' },
    evo065: { id: '934', structureSourcePub: '283' },
    lgcy065: { id: '914', structureSourcePub: '627' }
  };
  const LOCALES = ['es-us','en_CA','fr-ca','es-ar','es-mx','es-pe','es-co','es-cl','pt-br'];
  const ROOT = '3-4';
  const BB = '1-2';
  function explorerContainerUrl(pubId, segs) {
    const parts = ['cme:publications_tcm:0-' + pubId + '-1'];
    (segs || []).forEach((s) => parts.push(s));
    return DSCRIBE_BASE + '/ui/explorer?container=' + parts.join('_') + '&panel=information';
  }
  function sourcePubFromChain(chain) {
    if(!chain || !chain.length) return '';
    return (String(chain[0]).split(':')[1] || '').split('-')[0] || '';
  }
  function facilityExplorer(pubKey, kind, folderChain) {
    const id = PUBLISH_PUBS[pubKey].id;
    const chain = folderChain || [];
    const sourcePub = sourcePubFromChain(chain);
    const rootSuffix = kind === 'bb' ? BB : ROOT;
    if(pubKey === 'evo040' && sourcePub === '472' && chain.length){
      const native = ['tcm:472-' + rootSuffix];
      chain.forEach((t) => native.push(t));
      return explorerContainerUrl('472', native);
    }
    if(pubKey === 'evo065' && sourcePub === '501'){
      const id = PUBLISH_PUBS[pubKey].id;
      return explorerContainerUrl(id, ['tcm:' + id + '-' + (kind === 'bb' ? BB : ROOT)]);
    }
    const c = ['tcm:' + id + '-' + rootSuffix];
    chain.forEach((t) => c.push(remapTcm(t, id)));
    return explorerContainerUrl(id, c);
  }
  function remapTcm(tcmId, pubId) {
    if(!tcmId || !pubId) return tcmId;
    const p = (tcmId.split(':')[1] || '').split('-');
    if(p.length < 2) return tcmId;
    return p.length >= 3 ? 'tcm:' + pubId + '-' + p[1] + '-' + p[2] : 'tcm:' + pubId + '-' + p[1];
  }
  function facilityBB(k, chain){ return facilityExplorer(k, 'bb', chain); }
  function facilityRoot(k, chain){ return facilityExplorer(k, 'root', chain); }
  function pageFolderExplorer(pubKey, chain, itemNumber){
    const id = PUBLISH_PUBS[pubKey].id;
    if(!itemNumber) return null;
    const c = ['tcm:' + id + '-' + ROOT];
    (chain || []).forEach((t) => c.push(remapTcm(t, id)));
    const item = 'tcm:' + id + '-' + itemNumber + '-64';
    const container = ['cme:publications_tcm:0-' + id + '-1'].concat(c).join('_');
    return DSCRIBE_BASE + '/ui/explorer?container=' + container + '&item=' + encodeURIComponent(item) + '&panel=information';
  }
  function titleCase(slug){
    return String(slug || '').split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  function stripEnv(host){
    let h = String(host || '');
    if(h.startsWith('latest.')) h = h.slice(7);
    if(h.startsWith('stage.')) h = h.slice(6);
    return h;
  }
  function normalizeProdUrl(raw){
    const trimmed = String(raw || '').trim();
    if(!trimmed) return { error: 'Paste a URL first.' };
    let u;
    try { u = new URL(trimmed); } catch (_) { return { error: 'Invalid URL.' }; }
    if(!u.hostname.toLowerCase().includes('disney.go.com')) return { error: 'Expected a disney.go.com URL (v1: WDW dining).' };
    u.search = ''; u.hash = '';
    u.hostname = stripEnv(u.hostname);
    let path = u.pathname;
    if(!path.endsWith('/')) path += '/';
    const segments = path.split('/').filter(Boolean);
    const di = segments.indexOf('dining');
    if(di < 0) return { error: 'URL path should include /dining/…' };
    const after = segments.slice(di + 1);
    if(!after.length) return { error: 'Missing facility slug after /dining/.' };
    const slug = after[after.length - 1];
    const park = after.length > 1 ? after[0] : '';
    u.pathname = '/dining/' + after.join('/') + '/';
    return { prodUrl: u.toString(), slug, parkSegment: park, lookupKey: park ? park + '/' + slug : slug };
  }
  function stageFromProd(prodUrl, loc){
    const u = new URL(prodUrl);
    u.hostname = 'stage.' + stripEnv(u.hostname);
    if(loc){
      const seg = loc.replace(/^\/+|\/+$/g, '');
      const parts = u.pathname.split('/').filter(Boolean);
      if(parts[0] !== seg) u.pathname = '/' + seg + u.pathname;
    }
    return u.toString();
  }
  function latestFromProd(prodUrl){
    const u = new URL(prodUrl);
    u.hostname = 'latest.' + stripEnv(u.hostname);
    return u.toString();
  }
  function localeLatest(prodUrl, locale){
    const u = new URL(latestFromProd(prodUrl));
    const seg = String(locale || '').replace(/^\/+|\/+$/g, '');
    if(!seg) return u.toString();
    const parts = u.pathname.split('/').filter(Boolean);
    if(parts[0] !== seg) u.pathname = '/' + seg + u.pathname;
    return u.toString();
  }
  const links = {
    PUBLISH_PUBS, LOCALES, remapTcmToPublishPub: remapTcm,
    facilityBuildingBlocksExplorer: facilityBB, facilityRootPageExplorer: facilityRoot,
    titleCaseSlug: titleCase, normalizeProdUrl, stageUrlFromProd: stageFromProd,
    latestUrlFromProd: latestFromProd, localeLatestUrl: localeLatest
  };
  function urlPark(lookupKey){
    if(!lookupKey || lookupKey.indexOf('/') < 0) return '';
    return lookupKey.split('/')[0];
  }
  function entryPark(k, e){
    if(e && e.parkSegment) return e.parkSegment;
    if(k && k.indexOf('/') >= 0) return k.split('/')[0];
    return '';
  }
  function mergeSlots(a, b, allowReplace){
    if(!b) return a;
    if(!a) return b;
    const out = Object.assign({}, a);
    const bbIn = b.bbParentChain || [];
    const bbOut = out.bbParentChain || [];
    if(!bbOut.length && bbIn.length) out.bbParentChain = bbIn;
    else if(allowReplace && bbIn.length > bbOut.length) out.bbParentChain = bbIn;
    const pgIn = b.pageParentChain || [];
    const pgOut = out.pageParentChain || [];
    if(!pgOut.length && pgIn.length){
      out.pageParentChain = pgIn;
      out.pageTcm = b.pageTcm || out.pageTcm;
      out.itemNumber = b.itemNumber || out.itemNumber;
      out.pageTitle = b.pageTitle || out.pageTitle;
    } else if(allowReplace && pgIn.length > pgOut.length){
      out.pageParentChain = pgIn;
      out.pageTcm = b.pageTcm || out.pageTcm;
      out.itemNumber = b.itemNumber || out.itemNumber;
      out.pageTitle = b.pageTitle || out.pageTitle;
    }
    return out;
  }
  function mergeIndexEntry(a, b, allowReplace){
    if(!b) return a;
    if(!a) return Object.assign({}, b);
    const out = Object.assign({}, a);
    out.displayName = b.displayName || out.displayName;
    const rep = allowReplace !== false;
    ['evo040','evo065','lgcy065'].forEach((k) => { out[k] = mergeSlots(out[k], b[k], rep); });
    return out;
  }
  function indexKeyMatchesSlug(indexKey, entry, slug){
    if(!slug) return false;
    const e = entry || {};
    return e.slug === slug || indexKey === slug || indexKey.endsWith('/' + slug);
  }
  function entryChainScore(entry){
    if(!entry) return 0;
    let score = 0;
    ['evo040','evo065','lgcy065'].forEach((pubKey) => {
      const slot = slotForPub(entry, pubKey);
      if(!slot) return;
      score += bbChain(slot).length + pageChain(slot).length;
      if(slot.pageTcm) score += 2;
    });
    return score;
  }
  function mergeSlugFallback(entries, lookupKey, slug, existing){
    if(!slug || !entries) return existing;
    let fallback = existing ? Object.assign({}, existing) : null;
    for(const k of Object.keys(entries)){
      const e = entries[k];
      if(!e || k === lookupKey) continue;
      if(!indexKeyMatchesSlug(k, e, slug)) continue;
      fallback = fallback ? mergeIndexEntry(fallback, e, true) : Object.assign({}, e);
    }
    return fallback;
  }
  function lookupEntry(entries, lookupKey, slug){
    if(!entries) return null;
    const park = urlPark(lookupKey);
    let merged = entries[lookupKey] ? Object.assign({}, entries[lookupKey]) : null;
    for(const k of Object.keys(entries)){
      const e = entries[k];
      if(!e) continue;
      const sameSlug = indexKeyMatchesSlug(k, e, slug);
      if(!sameSlug || k === lookupKey) continue;
      const samePark = park && entryPark(k, e) === park;
      if(!merged){
        if(!park || samePark) merged = Object.assign({}, e);
        continue;
      }
      merged = mergeIndexEntry(merged, e, samePark);
    }
    if(!merged && entries[slug]) merged = Object.assign({}, entries[slug]);
    const fallback = mergeSlugFallback(entries, lookupKey, slug, merged);
    const before = entryChainScore(merged);
    const after = entryChainScore(fallback);
    if(fallback && (!merged || after > before)) merged = fallback;
    return merged;
  }
  function rawSlotForPub(entry, pubKey){
    if(!entry) return null;
    if(pubKey === 'evo040') return entry.evo040 || null;
    if(pubKey === 'evo065') return entry.evo065 || entry.evo || null;
    if(pubKey === 'lgcy065') return entry.lgcy065 || entry.lgcy || null;
    return null;
  }
  function sourcePubFromChain(chain){
    if(!chain || !chain.length) return '';
    return (String(chain[0]).split(':')[1] || '').split('-')[0] || '';
  }
  function slotQualityScore(slot, pubKey){
    if(!slot) return -1;
    const bbc = bbChain(slot);
    const pc = pageChain(slot);
    let score = pc.length * 20 + bbc.length;
    if(pubKey === 'evo040' || pubKey === 'evo065'){
      const bbPub = sourcePubFromChain(bbc);
      if(bbPub === '472') score += 500;
      else if(bbPub === '501') score -= 200;
    }
    if(slot.itemNumber) score += 5;
    return score;
  }
  function bestSlotForPubFromSlugRows(entries, slug, pubKey){
    if(!entries || !slug) return null;
    let best = null;
    let bestScore = -1;
    for(const k of Object.keys(entries)){
      const row = entries[k];
      if(!row || !indexKeyMatchesSlug(k, row, slug)) continue;
      const slot = rawSlotForPub(row, pubKey);
      const score = slotQualityScore(slot, pubKey);
      if(score > bestScore){ bestScore = score; best = slot; }
    }
    return best;
  }
  function enrichEntryFromSlugScan(entry, ctx){
    if(!entry || !ctx || !ctx.entries || !ctx.slug) return entry;
    const out = Object.assign({}, entry);
    ['evo040','evo065'].forEach((pubKey) => {
      const best = bestSlotForPubFromSlugRows(ctx.entries, ctx.slug, pubKey);
      if(!best) return;
      if(slotQualityScore(best, pubKey) > slotQualityScore(out[pubKey], pubKey)){
        out[pubKey] = Object.assign({}, best);
      }
    });
    const supplements = ctx.chainSupplementsBySlug && ctx.chainSupplementsBySlug[ctx.slug];
    if(supplements){
      ['evo040','evo065','lgcy065'].forEach((pubKey) => {
        const patch = supplements[pubKey];
        if(patch) out[pubKey] = mergeSlots(out[pubKey], patch, true);
      });
    }
    return out;
  }
  function slotForPub(entry, pubKey, ctx){
    if(!entry) return null;
    if(pubKey === 'evo040') return entry.evo040 || null;
    if(pubKey === 'evo065') return entry.evo065 || entry.evo || null;
    if(pubKey === 'lgcy065'){
      let slot = rawSlotForPub(entry, 'lgcy065');
      const supplement = ctx && ctx.lgcySlotsBySlug && ctx.slug ? ctx.lgcySlotsBySlug[ctx.slug] : null;
      if(supplement && supplement.pageParentChain && supplement.pageParentChain.length){
        const merged = Object.assign({}, supplement, { lgcyFromPageItem: true });
        slot = slot ? mergeSlots(slot, merged, true) : merged;
      }
      return slot;
    }
    return null;
  }
  function pageChain(slot){
    if(!slot) return [];
    if(Array.isArray(slot.pageParentChain) && slot.pageParentChain.length) return slot.pageParentChain;
    if(Array.isArray(slot.parentChain) && slot.parentChain.length) return slot.parentChain;
    return [];
  }
  function bbChain(slot){
    if(!slot || !Array.isArray(slot.bbParentChain)) return [];
    return slot.bbParentChain;
  }
  function categoryPayload(pubKey, slot){
    const bbc = bbChain(slot);
    const pc = pageChain(slot);
    let note = null;
    if(!slot){
      note = 'No facility folders in index for this slug — opening publication-level folders. Rebuild data/dining-slug-index.json from crawl.';
    } else if(slot.lgcyFromPageItem && pubKey === 'lgcy065'){
      note = 'LGCY065 page folder from pub 627 supplement (CMS page title may differ from URL slug).';
    } else if(!bbc.length && !pc.length){
      note = 'Index has no BB/page folder chains — opening publication-level folders. Rebuild with DSCRIBE_DATA crawl.';
    } else if(!bbc.length){
      note = 'No Building Blocks folder chain in index — BB link opens publication Building Blocks.';
    } else if(!pc.length){
      note = 'No Root/page folder chain in index — Root link opens publication Root.';
    }
    let rootPageLevelUrl = facilityRoot(pubKey, pc);
    if(slot && slot.itemNumber && pc.length){
      const withItem = pageFolderExplorer(pubKey, pc, slot.itemNumber);
      if(withItem) rootPageLevelUrl = withItem;
    }
    return {
      buildingBlocksUrl: facilityBB(pubKey, bbc),
      rootPageLevelUrl,
      note
    };
  }
  function resolveDiningUrl(rawUrl, entries, lgcySlotsBySlug, chainSupplementsBySlug){
    const norm = normalizeProdUrl(rawUrl);
    if(norm.error) return { ok: false, error: norm.error };
    const merged = lookupEntry(entries, norm.lookupKey, norm.slug);
    const slotCtx = {
      entries,
      slug: norm.slug,
      lgcySlotsBySlug: lgcySlotsBySlug || null,
      chainSupplementsBySlug: chainSupplementsBySlug || null
    };
    const entry = merged ? enrichEntryFromSlugScan(merged, slotCtx) : merged;
    const displayName = entry ? (entry.displayName || titleCase(norm.slug)) : titleCase(norm.slug);
    const warnings = [];
    if(!entry){
      warnings.push('Slug not found in dining index — showing title from URL only. Rebuild data/dining-slug-index.json from crawl.');
    } else if(norm.lookupKey && !entries[norm.lookupKey] && norm.parkSegment){
      warnings.push('No index row for this URL path — using CMS folder data from the same facility slug under a different path prefix.');
    }
    const locales = LOCALES.map((locale) => ({ locale, url: localeLatest(norm.prodUrl, locale) }));
    return {
      ok: true, slug: norm.slug, parkSegment: norm.parkSegment, lookupKey: norm.lookupKey, displayName,
      prodUrl: norm.prodUrl, stageUrl: stageFromProd(norm.prodUrl), latestUrl: latestFromProd(norm.prodUrl),
      locales,
      evo040: categoryPayload('evo040', slotForPub(entry, 'evo040', slotCtx)),
      evo065: categoryPayload('evo065', slotForPub(entry, 'evo065', slotCtx)),
      lgcy065: categoryPayload('lgcy065', slotForPub(entry, 'lgcy065', slotCtx)),
      warnings
    };
  }
  globalThis.ValidateResolverInline = { links, resolveDiningUrl };
})();

/* Validate view — paste prod dining URL, get forward links */
(function(){
  'use strict';

  let lastResult = null;

  function escapeHtml(s){
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function escapeAttr(s){
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function copyChip(text){
    if(text == null || text === '') return '';
    return '<button type="button" class="validate-copy-chip" data-copy="' + escapeAttr(text) + '">Copy</button>';
  }

  function linkRow(label, href, sub, copyText){
    if(!href) return '';
    const toCopy = copyText != null ? copyText : href;
    return '<div class="validate-link-row">' +
      '<span class="validate-link-label">' + escapeHtml(label) + '</span>' +
      '<a class="validate-link-href" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
      escapeHtml(sub || href) + '</a>' +
      copyChip(toCopy) +
      '</div>';
  }

  function bindValidateCopyChips(root){
    if(!root || root.dataset.copyBound === '1') return;
    root.dataset.copyBound = '1';
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.validate-copy-chip');
      if(!btn || !root.contains(btn)) return;
      e.preventDefault();
      const text = btn.getAttribute('data-copy');
      if(!text) return;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 1600);
      }).catch(() => {});
    });
  }

  /** D-Scribe publication blocks in Validate (chip + which link rows to show). */
  const VALIDATE_PUB_META = {
    evo040: {
      title: 'EVO040 WDW (en) Content',
      chip: 'EVO040',
      hint: 'Building Blocks only',
      bb: true,
      root: false,
      tone: 'evo040'
    },
    evo065: {
      title: 'EVO065 WDW Parent (All) Publish',
      chip: 'EVO065',
      hint: 'Building Blocks + Root / Page',
      bb: true,
      root: true,
      tone: 'evo065'
    },
    lgcy065: {
      title: 'LGCY065 Parent (All) Publish',
      chip: 'LGCY065',
      hint: 'Root / Page only (no Building Blocks)',
      bb: false,
      root: true,
      tone: 'lgcy065'
    }
  };

  const VALIDATE_PUB_ORDER = ['evo040', 'evo065', 'lgcy065'];

  function pubBlock(pubKey, tree){
    const meta = VALIDATE_PUB_META[pubKey];
    if(!tree || !meta) return '';
    let html = '<div class="validate-pub-block validate-pub-block--' + meta.tone + '">';
    html += '<div class="validate-pub-head">' +
      '<span class="validate-pub-chip validate-pub-chip--' + meta.tone + '">' + escapeHtml(meta.chip) + '</span>' +
      '<div class="validate-pub-head-text">' +
      '<div class="validate-pub-title">' + escapeHtml(meta.title) + '</div>' +
      '<div class="validate-pub-hint">' + escapeHtml(meta.hint) + '</div>' +
      '</div></div>';
    if(meta.bb) html += linkRow('Building Blocks', tree.buildingBlocksUrl, 'Open Building Blocks');
    if(meta.root) html += linkRow('Root/Page Level', tree.rootPageLevelUrl, 'Open Root / page level');
    let note = tree.note;
    if(note && !meta.root && /root\/page/i.test(note)) note = null;
    if(note && !meta.bb && /building blocks/i.test(note)) note = null;
    if(note){
      html += '<p class="validate-note">' + escapeHtml(note) + '</p>';
    }
    html += '</div>';
    return html;
  }

  function mdxBlock(mdx){
    if(!mdx) return '';
    let html = '<div class="validate-mdx-block"><div class="validate-pub-title">MDX app deep link</div>';
    if(mdx.ok && mdx.href){
      html += linkRow('Detail URI', mdx.href, mdx.href);
      html += '<div class="validate-link-row"><span class="validate-link-label">facilityId</span>' +
        '<span class="validate-link-href validate-mdx-meta">' + escapeHtml(mdx.facilityId) + '</span>' +
        copyChip(mdx.facilityId) + '</div>';
      html += '<div class="validate-link-row"><span class="validate-link-label">entityType</span>' +
        '<span class="validate-link-href validate-mdx-meta">' + escapeHtml(mdx.entityType) + '</span>' +
        copyChip(mdx.entityType) + '</div>';
      if(mdx.htmlSnippet){
        html += '<div class="validate-link-row validate-mdx-snippet-row">' +
          '<span class="validate-link-label">MDX link</span>' +
          '<code class="validate-mdx-code">' + escapeHtml(mdx.htmlSnippet) + '</code>' +
          copyChip(mdx.htmlSnippet) +
          '</div>';
      }
    } else if(mdx.note){
      html += '<p class="validate-note">' + escapeHtml(mdx.note) + '</p>';
    }
    html += '</div>';
    return html;
  }

  function localesBlock(locales){
    if(!locales || !locales.length) return '';
    let html = '<div class="validate-locales-block"><div class="validate-pub-title">Locales (latest)</div>';
    locales.forEach((row) => {
      html += linkRow(row.locale, row.url, row.url);
    });
    html += '</div>';
    return html;
  }

  function renderResult(data){
    const out = document.getElementById('validateResults');
    if(!out) return;
    if(!data.ok){
      out.innerHTML = '<div class="error-box">' + escapeHtml(data.error || 'Could not resolve URL.') + '</div>';
      return;
    }
    lastResult = data;
    let html = '<section class="panel-block validate-results">';
    html += '<div class="section-title">RESOLVED</div>';
    html += '<div class="validate-name-row">' +
      '<div class="validate-name">' + escapeHtml(data.displayName) + '</div>' +
      '<div class="validate-name-actions">' +
      '<button type="button" class="validate-map-btn" id="validateMapBtn">Content map</button>' +
      '<button type="button" class="validate-map-live-btn" id="validateMapLiveBtn" disabled title="Coming soon — save a D-Scribe session cookie for live page component links.">Live map</button>' +
      '</div></div>';
    if(data.warnings && data.warnings.length){
      html += '<div class="validate-warn">' + data.warnings.map(escapeHtml).join('<br>') + '</div>';
    }
    html += linkRow('Production', data.prodUrl, data.prodUrl);
    html += linkRow('Stage', data.stageUrl, data.stageUrl);
    html += linkRow('Latest', data.latestUrl, data.latestUrl);
    html += '<div class="validate-dscribe-sections">';
    html += '<div class="validate-dscribe-sections-label">D-Scribe publications</div>';
    VALIDATE_PUB_ORDER.forEach((k) => {
      html += pubBlock(k, data[k]);
    });
    html += '</div>';
    html += mdxBlock(data.mdx);
    html += localesBlock(data.locales);
    html += '<div class="validate-actions">' +
      '<button type="button" class="config-save-btn" id="validateCopyBtn">Copy all links</button>' +
      '</div></section>';
    out.innerHTML = html;
    bindValidateCopyChips(out);
    const copyBtn = document.getElementById('validateCopyBtn');
    if(copyBtn) copyBtn.addEventListener('click', copyAllLinks);
    const mapBtn = document.getElementById('validateMapBtn');
    if(mapBtn) mapBtn.addEventListener('click', () => openFacilityGraph(false));
    const mapLiveBtn = document.getElementById('validateMapLiveBtn');
    if(mapLiveBtn){
      mapLiveBtn.addEventListener('click', () => {
        alert('Live content map is not available yet. Save a D-Scribe session cookie when it ships to resolve page component links from CMS.');
      });
    }
  }

  function collectLinks(data){
    const lines = [
      data.displayName,
      'Prod: ' + data.prodUrl,
      'Stage: ' + data.stageUrl,
      'Latest: ' + data.latestUrl
    ];
    VALIDATE_PUB_ORDER.forEach((k) => {
      const t = data[k];
      const meta = VALIDATE_PUB_META[k];
      if(!t || !meta) return;
      lines.push('', meta.chip + ' — ' + meta.title);
      if(meta.bb && t.buildingBlocksUrl) lines.push('Building Blocks: ' + t.buildingBlocksUrl);
      if(meta.root && t.rootPageLevelUrl) lines.push('Root/Page Level: ' + t.rootPageLevelUrl);
    });
    if(data.mdx && data.mdx.ok && data.mdx.href){
      lines.push('', 'MDX detail');
      lines.push('URI: ' + data.mdx.href);
      lines.push('facilityId: ' + data.mdx.facilityId + '; entityType: ' + data.mdx.entityType);
      if(data.mdx.htmlSnippet) lines.push('MDX link: ' + data.mdx.htmlSnippet);
    }
    if(data.locales && data.locales.length){
      lines.push('', 'Locales (latest)');
      data.locales.forEach((row) => {
        lines.push(row.locale + ': ' + row.url);
      });
    }
    return lines.join('\n');
  }

  function copyAllLinks(){
    if(!lastResult || !lastResult.ok) return;
    const text = collectLinks(lastResult);
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('validateCopyBtn');
      if(btn){
        const prev = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = prev; }, 2000);
      }
    }).catch(() => {});
  }

  function coerceDiningInput(raw){
    const t = String(raw || '').trim();
    if(!t) return t;
    if(/^https?:\/\//i.test(t)) return t;
    let path = t.replace(/^\/+/, '');
    if(path.indexOf('dining/') !== 0 && path.indexOf('dining/') === -1){
      path = 'dining/' + path;
    } else if(path.indexOf('dining/') > 0){
      path = path.slice(path.indexOf('dining/'));
    }
    if(!path.endsWith('/')) path += '/';
    return 'https://disneyworld.disney.go.com/' + path;
  }

  function shouldAutoResolve(value){
    const v = String(value || '').trim();
    if(v.length < 10) return false;
    if(/disney\.go\.com/i.test(v)) return true;
    return /dining\/[^/]+\/[^/]+/.test(v.replace(/^\/+/, ''));
  }

  function loadScriptOnce(src){
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-validate-src="' + src + '"]');
      if(existing){
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error(src)));
        if(existing.dataset.loaded === '1') resolve();
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.dataset.validateSrc = src;
      el.onload = () => { el.dataset.loaded = '1'; resolve(); };
      el.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(el);
    });
  }

  async function ensureResolverModules(){
    if(globalThis.ValidateResolverInline) return true;
    if(globalThis.DScribeLinks && globalThis.DiningResolveCore) return true;
    const tries = [
      'validate-resolver-inline.js',
      'scripts/dscribe/dscribe-links.js',
      'scripts/dscribe/dining-resolve-core.js'
    ];
    for(const src of tries){
      try {
        await loadScriptOnce(src);
      } catch (_) {}
      if(globalThis.ValidateResolverInline) return true;
      if(globalThis.DScribeLinks && globalThis.DiningResolveCore) return true;
    }
    return !!(globalThis.ValidateResolverInline ||
      (globalThis.DScribeLinks && globalThis.DiningResolveCore));
  }

  function mdxFromSlugIndex(slug, entries){
    const key = String(slug || '').toLowerCase();
    const hit = entries && entries[key];
    if(!hit || !hit.facilityId) return { ok: false, note: 'No facility ID in data/mdx-facility-by-slug.json for this slug.' };
    const entityType = hit.entityType || 'restaurant';
    const href = hit.href || ('mdx://finder/detail?facilityId=' + hit.facilityId + ';entityType=' + entityType);
    const label = hit.name || slug;
    const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return {
      ok: true,
      facilityId: hit.facilityId,
      entityType,
      href,
      htmlSnippet: '<a href="' + href + '">' + esc + '</a>',
      name: hit.name || null,
      note: null
    };
  }

  async function resolveInBrowser(raw){
    const coerced = coerceDiningInput(raw);
    await ensureResolverModules();
    let entries = {};
    let lgcySlots = {};
    let chainSupplements = {};
    let mdxEntries = {};
    try {
      const idxRes = await fetch('/data/dining-slug-index.json');
      if(idxRes.ok){
        const idx = await idxRes.json();
        entries = idx.entries || idx;
      }
    } catch (_) {}
    try {
      const lgcyRes = await fetch('/data/dining-lgcy-slots-by-slug.json');
      if(lgcyRes.ok) lgcySlots = await lgcyRes.json();
    } catch (_) {}
    try {
      const supRes = await fetch('/data/dining-chain-supplements-by-slug.json');
      if(supRes.ok) chainSupplements = await supRes.json();
    } catch (_) {}
    try {
      const mdxRes = await fetch('/data/mdx-facility-by-slug.json');
      if(mdxRes.ok){
        const mdxIdx = await mdxRes.json();
        mdxEntries = mdxIdx.entries || mdxIdx;
      }
    } catch (_) {}

    let data;
    if(globalThis.DScribeLinks && globalThis.DiningResolveCore){
      data = globalThis.DiningResolveCore.resolveDiningUrl(coerced, globalThis.DScribeLinks, entries, lgcySlots, chainSupplements);
    } else if(globalThis.ValidateResolverInline){
      data = globalThis.ValidateResolverInline.resolveDiningUrl(coerced, entries, lgcySlots, chainSupplements);
    } else {
      return {
        ok: false,
        error: 'Resolver failed to load. Hard refresh (Cmd+Shift+R), then git pull and restart npm start from the JiraDash folder.'
      };
    }
    if(data.ok){
      data.warnings = (data.warnings || []).slice();
      data.warnings.unshift('Resolved locally (index + link map). Restart npm start to use /api/dining/resolve.');
      data.mdx = mdxFromSlugIndex(data.slug, mdxEntries);
    }
    return data;
  }

  function apiRouteMissing(data, status){
    return status === 404 && data && data.message === 'Unknown API route';
  }

  async function resolveUrl(raw){
    const coerced = coerceDiningInput(raw);
    const out = document.getElementById('validateResults');
    if(out) out.innerHTML = '<div class="loading-wrap"><div class="spinner"></div>Resolving&hellip;</div>';
    try{
      const res = await fetch('/api/dining/resolve?url=' + encodeURIComponent(coerced));
      let data;
      try {
        data = await res.json();
      } catch (_) {
        renderResult({
          ok: false,
          error: 'Server returned a non-JSON response (HTTP ' + res.status + '). Restart npm start after pulling the latest code.'
        });
        return;
      }
      if(apiRouteMissing(data, res.status)){
        renderResult(await resolveInBrowser(coerced));
        return;
      }
      if(data.ok !== true){
        const msg =
          data.error ||
          data.message ||
          (res.status === 404
            ? 'Validate API not found. Stop the server (Ctrl+C) and run npm start again from the repo root after git pull.'
            : 'Could not resolve URL (HTTP ' + res.status + ').');
        renderResult({ ok: false, error: msg });
        return;
      }
      renderResult(data);
    } catch(err){
      renderResult({
        ok: false,
        error: (err && err.message ? err.message : 'Request failed') +
          '. Use http://127.0.0.1:3847/ (npm start), not a file:// URL.'
      });
    }
  }

  let validateBound = false;

  function closeGraphModal(){
    const modal = document.getElementById('validateGraphModal');
    if(modal){
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  async function openFacilityGraph(){
    if(!lastResult || !lastResult.ok || !lastResult.prodUrl){
      alert('Resolve a URL first.');
      return;
    }
    const modal = document.getElementById('validateGraphModal');
    const cyEl = document.getElementById('validateGraphCy');
    const titleEl = document.getElementById('validateGraphTitle');
    const subEl = document.getElementById('validateGraphSub');
    const legendEl = document.getElementById('validateGraphLegend');
    if(!modal || !cyEl) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    if(titleEl) titleEl.textContent = lastResult.displayName || 'Facility';
    if(subEl) subEl.textContent = 'Loading from local D-Scribe crawl…';
    if(legendEl) legendEl.textContent = '';
    cyEl.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
    try {
      const res = await fetch('/api/dining/graph?url=' + encodeURIComponent(lastResult.prodUrl));
      const graph = await res.json();
      if(!graph.ok){
        cyEl.innerHTML = '<div class="error-box">' + escapeHtml(graph.error || 'Could not build graph.') + '</div>';
        return;
      }
      cyEl.innerHTML = '';
      if(subEl){
        let sub = graph.nodeCount + ' D-Scribe links · offline crawl';
        if(graph.truncated) sub += ' (truncated)';
        subEl.textContent = sub;
      }
      if(legendEl && graph.legend && graph.legend.hint){
        legendEl.textContent = graph.legend.hint;
      }
      const rows = (graph.nodes || []).filter((n) => n.explorerUrl);
      let html = '<ul class="validate-graph-links">';
      rows.forEach((n) => {
        const page = n.nodeType === 'Page';
        html += '<li class="validate-graph-link-row' + (page ? ' is-page' : '') + '">' +
          '<a class="validate-graph-open" href="' + escapeAttr(n.explorerUrl) + '" target="_blank" rel="noopener" title="Open in D-Scribe">Open</a>' +
          '<span class="validate-graph-link-name">' + escapeHtml(n.label) + '</span>' +
          '</li>';
      });
      html += '</ul>';
      cyEl.innerHTML = html;
    } catch (err) {
      cyEl.innerHTML = '<div class="error-box">' + escapeHtml(err && err.message ? err.message : 'Graph failed') + '</div>';
    }
  }

  async function refreshDscribeSessionStatus(){
    const statusEl = document.getElementById('validateDscribeStatus');
    const noteEl = document.getElementById('validateDscribeNote');
    if(!statusEl) return;
    try {
      const res = await fetch('/api/dscribe/session');
      const data = await res.json();
      if(data.valid){
        statusEl.textContent = 'Active';
        statusEl.className = 'validate-dscribe-status ok';
        if(noteEl) noteEl.textContent = 'Live CMS lookup available when the slug index is incomplete.';
      } else if(data.configured){
        statusEl.textContent = 'Expired';
        statusEl.className = 'validate-dscribe-status warn';
        if(noteEl) noteEl.textContent = data.error || 'Paste a fresh cookie and Save session.';
      } else {
        statusEl.textContent = 'Not set';
        statusEl.className = 'validate-dscribe-status';
        if(noteEl) noteEl.textContent = 'Optional — only needed when facility folder chains are missing from the index/crawl.';
      }
    } catch (_) {
      statusEl.textContent = 'Unknown';
      statusEl.className = 'validate-dscribe-status warn';
    }
  }

  async function saveDscribeSession(){
    const ta = document.getElementById('validateDscribeCookie');
    const noteEl = document.getElementById('validateDscribeNote');
    const cookie = ta ? ta.value.trim() : '';
    try {
      const res = await fetch('/api/dscribe/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie })
      });
      const data = await res.json();
      if(!res.ok || !data.ok){
        if(noteEl) noteEl.textContent = data.error || 'Could not save session.';
        await refreshDscribeSessionStatus();
        return;
      }
      if(ta) ta.value = '';
      if(noteEl) noteEl.textContent = 'Session saved for this server run (memory only).';
      await refreshDscribeSessionStatus();
    } catch (err) {
      if(noteEl) noteEl.textContent = err && err.message ? err.message : 'Save failed.';
    }
  }

  function initValidateView(){
    if(validateBound) return;
    validateBound = true;
    const input = document.getElementById('validateUrlInput');
    const btn = document.getElementById('validateResolveBtn');
    if(!input || !btn) return;

    refreshDscribeSessionStatus();
    const saveBtn = document.getElementById('validateDscribeSaveBtn');
    const clearBtn = document.getElementById('validateDscribeClearBtn');
    if(saveBtn) saveBtn.addEventListener('click', () => { saveDscribeSession(); });
    if(clearBtn) clearBtn.addEventListener('click', () => {
      const ta = document.getElementById('validateDscribeCookie');
      if(ta) ta.value = '';
      fetch('/api/dscribe/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: '' })
      }).then(() => refreshDscribeSessionStatus());
    });

    function run(){
      resolveUrl(input.value);
    }
    btn.addEventListener('click', run);
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter') run();
    });
    input.addEventListener('paste', () => {
      setTimeout(() => {
        if(shouldAutoResolve(input.value)) run();
      }, 0);
    });
    const resultsRoot = document.getElementById('validateResults');
    if(resultsRoot) bindValidateCopyChips(resultsRoot);
    const graphClose = document.getElementById('validateGraphClose');
    const graphBackdrop = document.getElementById('validateGraphBackdrop');
    if(graphClose) graphClose.addEventListener('click', closeGraphModal);
    if(graphBackdrop) graphBackdrop.addEventListener('click', closeGraphModal);
    const graphLive = document.getElementById('validateGraphLiveBtn');
    if(graphLive){
      graphLive.addEventListener('click', () => {
        alert('Live content map is not available yet. Save a D-Scribe session cookie when it ships to resolve page component links from CMS.');
      });
    }
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') closeGraphModal();
    });
  }

  window.initValidateView = initValidateView;
})();

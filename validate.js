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
    return DSCRIBE_BASE + '/ui/#/explorer?container=' + parts.join('_') + '&panel=information';
  }
  function remapTcm(tcmId, pubId) {
    if(!tcmId || !pubId) return tcmId;
    const p = (tcmId.split(':')[1] || '').split('-');
    if(p.length < 2) return tcmId;
    return p.length >= 3 ? 'tcm:' + pubId + '-' + p[1] + '-' + p[2] : 'tcm:' + pubId + '-' + p[1];
  }
  function facilityBB(k, chain){
    const id = PUBLISH_PUBS[k].id;
    const c = ['tcm:' + id + '-' + BB];
    (chain || []).forEach((t) => c.push(remapTcm(t, id)));
    return explorerContainerUrl(id, c);
  }
  function facilityRoot(k, chain){
    const id = PUBLISH_PUBS[k].id;
    const c = ['tcm:' + id + '-' + ROOT];
    (chain || []).forEach((t) => c.push(remapTcm(t, id)));
    return explorerContainerUrl(id, c);
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
  function lookupEntry(entries, lookupKey, slug){
    if(!entries) return null;
    if(entries[lookupKey]) return entries[lookupKey];
    if(entries[slug]) return entries[slug];
    for(const k of Object.keys(entries)){
      if(k.endsWith('/' + slug) || k === slug) return entries[k];
    }
    return null;
  }
  function slotForPub(entry, pubKey){
    if(!entry) return null;
    if(pubKey === 'evo040') return entry.evo040 || null;
    if(pubKey === 'evo065') return entry.evo065 || entry.evo || null;
    if(pubKey === 'lgcy065') return entry.lgcy065 || entry.lgcy || null;
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
    } else if(!bbc.length && !pc.length){
      note = 'Index has no BB/page folder chains — opening publication-level folders. Rebuild with DSCRIBE_DATA crawl.';
    } else if(!bbc.length){
      note = 'No Building Blocks folder chain in index — BB link opens publication Building Blocks.';
    } else if(!pc.length){
      note = 'No Root/page folder chain in index — Root link opens publication Root.';
    }
    return {
      buildingBlocksUrl: facilityBB(pubKey, bbc),
      rootPageLevelUrl: facilityRoot(pubKey, pc),
      note
    };
  }
  function resolveDiningUrl(rawUrl, entries){
    const norm = normalizeProdUrl(rawUrl);
    if(norm.error) return { ok: false, error: norm.error };
    const entry = lookupEntry(entries, norm.lookupKey, norm.slug);
    const displayName = entry ? (entry.displayName || titleCase(norm.slug)) : titleCase(norm.slug);
    const warnings = [];
    if(!entry) warnings.push('Slug not found in dining index — showing title from URL only. Rebuild data/dining-slug-index.json from crawl.');
    const locales = LOCALES.map((locale) => ({ locale, url: localeLatest(norm.prodUrl, locale) }));
    return {
      ok: true, slug: norm.slug, parkSegment: norm.parkSegment, lookupKey: norm.lookupKey, displayName,
      prodUrl: norm.prodUrl, stageUrl: stageFromProd(norm.prodUrl), latestUrl: latestFromProd(norm.prodUrl),
      locales,
      evo040: categoryPayload('evo040', slotForPub(entry, 'evo040')),
      evo065: categoryPayload('evo065', slotForPub(entry, 'evo065')),
      lgcy065: categoryPayload('lgcy065', slotForPub(entry, 'lgcy065')),
      warnings
    };
  }
  globalThis.ValidateResolverInline = { links, resolveDiningUrl };
})();

/* Validate view — paste prod dining URL, get forward links */
(function(){
  'use strict';

  let lastResult = null;

  const PUB_LABELS = {
    evo040: 'EVO040 WDW (en) Content',
    evo065: 'EVO065 WDW Parent (All) Publish',
    lgcy065: 'LGCY065 Parent (All) Publish'
  };

  function escapeHtml(s){
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function linkRow(label, href, sub){
    if(!href) return '';
    return '<div class="validate-link-row">' +
      '<span class="validate-link-label">' + escapeHtml(label) + '</span>' +
      '<a class="validate-link-href" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
      escapeHtml(sub || href) + '</a></div>';
  }

  function pubBlock(title, tree){
    if(!tree) return '';
    let html = '<div class="validate-pub-block"><div class="validate-pub-title">' + escapeHtml(title) + '</div>';
    html += linkRow('Building Blocks', tree.buildingBlocksUrl, 'Open Building Blocks');
    html += linkRow('Root/Page Level', tree.rootPageLevelUrl, 'Open Root / page level');
    if(tree.note){
      html += '<p class="validate-note">' + escapeHtml(tree.note) + '</p>';
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
    html += '<div class="validate-name">' + escapeHtml(data.displayName) + '</div>';
    if(data.warnings && data.warnings.length){
      html += '<div class="validate-warn">' + data.warnings.map(escapeHtml).join('<br>') + '</div>';
    }
    html += linkRow('Production', data.prodUrl, data.prodUrl);
    html += linkRow('Stage', data.stageUrl, data.stageUrl);
    html += linkRow('Latest', data.latestUrl, data.latestUrl);
    html += pubBlock(PUB_LABELS.evo040, data.evo040);
    html += pubBlock(PUB_LABELS.evo065, data.evo065);
    html += pubBlock(PUB_LABELS.lgcy065, data.lgcy065);
    html += localesBlock(data.locales);
    html += '<div class="validate-actions">' +
      '<button type="button" class="config-save-btn" id="validateCopyBtn">Copy all links</button>' +
      '</div></section>';
    out.innerHTML = html;
    const copyBtn = document.getElementById('validateCopyBtn');
    if(copyBtn) copyBtn.addEventListener('click', copyAllLinks);
  }

  function collectLinks(data){
    const lines = [
      data.displayName,
      'Prod: ' + data.prodUrl,
      'Stage: ' + data.stageUrl,
      'Latest: ' + data.latestUrl
    ];
    ['evo040', 'evo065', 'lgcy065'].forEach((k) => {
      const t = data[k];
      if(!t) return;
      lines.push('', PUB_LABELS[k] || k);
      if(t.buildingBlocksUrl) lines.push('Building Blocks: ' + t.buildingBlocksUrl);
      if(t.rootPageLevelUrl) lines.push('Root/Page Level: ' + t.rootPageLevelUrl);
    });
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

  async function resolveInBrowser(raw){
    const coerced = coerceDiningInput(raw);
    await ensureResolverModules();
    let entries = {};
    try {
      const idxRes = await fetch('/data/dining-slug-index.json');
      if(idxRes.ok){
        const idx = await idxRes.json();
        entries = idx.entries || idx;
      }
    } catch (_) {}

    let data;
    if(globalThis.ValidateResolverInline){
      data = globalThis.ValidateResolverInline.resolveDiningUrl(coerced, entries);
    } else if(globalThis.DScribeLinks && globalThis.DiningResolveCore){
      data = globalThis.DiningResolveCore.resolveDiningUrl(coerced, globalThis.DScribeLinks, entries);
    } else {
      return {
        ok: false,
        error: 'Resolver failed to load. Hard refresh (Cmd+Shift+R), then git pull and restart npm start from the JiraDash folder.'
      };
    }
    if(data.ok){
      data.warnings = (data.warnings || []).slice();
      data.warnings.unshift('Resolved locally (index + link map). Restart npm start to use /api/dining/resolve.');
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

  function initValidateView(){
    if(validateBound) return;
    validateBound = true;
    const input = document.getElementById('validateUrlInput');
    const btn = document.getElementById('validateResolveBtn');
    if(!input || !btn) return;

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
  }

  window.initValidateView = initValidateView;
})();

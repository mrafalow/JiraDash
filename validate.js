/* Validate view — paste prod dining URL, get forward links */
(function(){
  'use strict';

  let lastResult = null;

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
    html += linkRow('Root', tree.publicationRootUrl, 'Open Root in D-Scribe');
    html += linkRow('Building Blocks', tree.publicationBuildingBlocksUrl, 'Open Building Blocks');
    if(tree.explorerFolderUrl){
      html += linkRow('Facility folder', tree.explorerFolderUrl, 'Explorer (page selected)');
    }
    if(tree.editorPageUrl){
      html += linkRow('Edit page', tree.editorPageUrl, tree.pageTcm || 'Open page editor');
    }
    if(tree.note && !tree.explorerFolderUrl){
      html += '<p class="validate-note">' + escapeHtml(tree.note) + '</p>';
    }
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
    html += linkRow('Stage (en_CA)', data.stageUrlEnCa, data.stageUrlEnCa);
    html += pubBlock('EVO065 WDW Parent (All) Publish', data.evo);
    html += pubBlock('LGCY065 Parent (All) Publish', data.lgcy);
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
      'Stage en_CA: ' + data.stageUrlEnCa
    ];
    ['evo', 'lgcy'].forEach((k) => {
      const t = data[k];
      if(!t) return;
      lines.push('', t === data.evo ? 'EVO065' : 'LGCY065');
      if(t.publicationRootUrl) lines.push('Root: ' + t.publicationRootUrl);
      if(t.publicationBuildingBlocksUrl) lines.push('Building Blocks: ' + t.publicationBuildingBlocksUrl);
      if(t.explorerFolderUrl) lines.push('Folder: ' + t.explorerFolderUrl);
      if(t.editorPageUrl) lines.push('Editor: ' + t.editorPageUrl);
    });
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

  async function resolveUrl(raw){
    const out = document.getElementById('validateResults');
    if(out) out.innerHTML = '<div class="loading-wrap"><div class="spinner"></div>Resolving&hellip;</div>';
    try{
      const res = await fetch('/api/dining/resolve?url=' + encodeURIComponent(raw));
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
      setTimeout(run, 0);
    });
  }

  window.initValidateView = initValidateView;
})();

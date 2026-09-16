/* ============================================================
   app.js — wire UI, rendering, and data loading
   ============================================================ */
let STATE = { data: null, expandedKeys: new Set(), tableMode: 'active', sortKey: null, sortDir: 1 };

function iconSvg(name){
  const icons = {
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3l9 16H3L12 3zM12 10v4M12 17.5h.01"/></svg>',
    users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M17 8.2a3 3 0 010 5.8M21 19c0-2.5-1.8-4.3-4-5"/></svg>'
  };
  return icons[name] || '';
}

function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function renderTicketList(){
  const container = document.getElementById('ticketList');
  const tickets = STATE.data.activeTickets;
  if(!tickets.length){
    container.innerHTML = '<div class="empty-state"><b>Nothing active right now</b>New requests will show up here the moment they are assigned to you.</div>';
    return;
  }
  const scored = tickets.map(t => {
    const model = buildStageModel(t);
    const scoring = computeScore(t, model);
    return { t, model, scoring };
  }).sort((a,b) => b.scoring.score - a.scoring.score);

  container.innerHTML = scored.map(({t, model, scoring}) => {
    const isExpanded = STATE.expandedKeys.has(t.key);
    const tag = buildTag(t, model, scoring);
    const priorityShort = (t.priority || '').replace(/^\d+ - /,'');
    const dueLabel = scoring.daysUntilDue === 0 ? 'Today' : scoring.daysUntilDue < 0 ? Math.abs(scoring.daysUntilDue)+'d overdue' : 'In '+scoring.daysUntilDue+'d';

    const subtaskRows = (t.subtasks || []).map(st => {
      const color = st.status === 'Closed' ? 'var(--green)' : (st.assigneeIsCurrentUser === false ? 'var(--band-orange)' : 'var(--band-blue)');
      const label = STAGE_LABELS[st.type] || st.type;
      const stLink = jiraLink(st.key);
      const labelHtml = stLink ? '<a class="jira-link" href="'+stLink+'" target="_blank" rel="noopener">'+label+'</a>' : label;
      let tagText = st.status === 'Closed' ? 'Done' : (st.assigneeIsCurrentUser === false ? 'Waiting on ' + (st.assigneeName || 'other') : 'In progress');
      return '<div class="subtask-row">' +
        '<span class="status-dot" style="background:'+color+'"></span>' +
        '<span class="subtask-type">'+labelHtml+'</span>' +
        '<span class="subtask-tag">'+tagText+'</span>' +
        '<span class="subtask-assignee">'+(st.assigneeName || '')+'</span>' +
        '</div>';
    }).join('');

    const tLink = jiraLink(t.key);
    const summaryHtml = tLink ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(t.summary)+'</a>' : escapeHtml(t.summary);

    return '<div class="ticket-card'+(isExpanded?' expanded':'')+'" style="--band-color:'+BAND_COLOR[scoring.band]+'" data-key="'+t.key+'">' +
      '<div class="ticket-row" data-toggle="'+t.key+'">' +
        '<div class="score-badge" style="background:'+BAND_BG[scoring.band]+';color:'+BAND_COLOR[scoring.band]+'">'+scoring.score+'</div>' +
        '<div class="ticket-main">' +
          '<div class="ticket-summary">'+summaryHtml+'</div>' +
          '<div class="ticket-tag">'+tag+'</div>' +
        '</div>' +
        '<div class="ticket-meta">' +
          '<div class="meta-col">Due<div class="val">'+dueLabel+'</div></div>' +
          '<div class="priority-chip" style="background:'+BAND_BG[scoring.band]+';color:'+BAND_COLOR[scoring.band]+'">'+priorityShort+'</div>' +
          (model.timelineTight ? '<div class="priority-chip" style="background:var(--band-orange-bg);color:var(--band-orange);" title="Even hitting every checkpoint on schedule, PR + confirmation don\'t fit before the due date">Tight timeline</div>' : '') +
        '</div>' +
        '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>' +
      '</div>' +
      (isExpanded ? '<div class="subtask-list">'+subtaskRows+'</div>' : '') +
    '</div>';
  }).join('');

  container.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', (e) => {
      if(e.target.closest('a')) return;
      const key = el.getAttribute('data-toggle');
      if(STATE.expandedKeys.has(key)) STATE.expandedKeys.delete(key);
      else STATE.expandedKeys.add(key);
      renderTicketList();
    });
  });
}

function renderBottomStrip(){
  const tickets = STATE.data.activeTickets;
  const today = todayMid();
  const scored = tickets.map(t => ({ t, model: buildStageModel(t), scoring: computeScore(t, buildStageModel(t)) }));

  const dueToday = tickets.filter(t => atMidnight(t.dueDate).getTime() === today.getTime());
  const atRisk = scored.filter(({model}) => model.stageGap > 0);
  const waiting = scored.filter(({model}) => model.currentOpen && !model.currentOpen.missing && model.currentOpen.subtask && model.currentOpen.subtask.assigneeIsCurrentUser === false);

  let publishState = 'off';
  if(dueToday.length){
    const anyUnapproved = dueToday.some(t => {
      const wf = (t.subtasks||[]).find(s => s.type === 'WF');
      return !wf || wf.status !== 'Closed';
    });
    publishState = anyUnapproved ? 'red' : 'green';
  }

  const condCounts = { COPY:0, MEDIA:0, ALTTEXT:0 };
  scored.forEach(({t}) => {
    (t.subtasks || []).forEach(st => {
      if(Object.prototype.hasOwnProperty.call(condCounts, st.type) && st.status !== 'Closed'){
        condCounts[st.type]++;
      }
    });
  });
  const condTotal = condCounts.COPY + condCounts.MEDIA + condCounts.ALTTEXT;

  document.getElementById('bottomStripWrap').style.display = 'block';
  document.getElementById('bottomStrip').innerHTML =
    '<div class="strip-card publish-light-card">' +
      '<div class="light '+(publishState==='off'?'':publishState)+'"></div>' +
      '<div class="publish-light-label">'+(publishState==='off'?'Nothing publishing today':publishState==='green'?'Clear to publish':'Unlock needed — go now')+'</div>' +
    '</div>' +
    strip('warning', 'var(--band-orange)', 'At Risk', atRisk.length, atRisk.length ? 'Behind expected pace' : 'All on pace') +
    strip('calendar', 'var(--band-red)', 'Due Today', dueToday.length, dueToday.length ? 'Needs a look' : 'Nothing due') +
    strip('users', 'var(--band-blue)', 'Waiting on Others', waiting.length, waiting.length ? 'Sitting with someone else' : 'Nothing stalled') +
    '<div class="strip-card donut-card">' + donutSvg(condCounts, condTotal) +
      '<div class="donut-legend">' +
        legendRow('var(--accent-pink)','Copy',condCounts.COPY) +
        legendRow('var(--band-orange)','Media',condCounts.MEDIA) +
        legendRow('var(--band-gold)','Alt Text',condCounts.ALTTEXT) +
      '</div>' +
    '</div>';
}
function strip(icon, color, label, value, sub){
  return '<div class="strip-card">' +
    '<div class="metric-icon" style="background:transparent;color:'+color+'">'+iconSvg(icon)+'</div>' +
    '<div class="metric-label">'+label+'</div>' +
    '<div class="metric-value">'+value+'</div>' +
    '<div class="metric-sub" style="color:'+color+'">'+sub+'</div>' +
  '</div>';
}
function legendRow(color,label,count){
  return '<div class="row"><span class="swatch" style="background:'+color+'"></span>'+label+' <span class="count">'+count+'</span></div>';
}
function donutSvg(counts, total){
  const size=84, r=32, cx=size/2, cy=size/2, circ=2*Math.PI*r;
  const segs = [
    {v:counts.COPY, c:'var(--accent-pink)'},
    {v:counts.MEDIA, c:'var(--band-orange)'},
    {v:counts.ALTTEXT, c:'var(--band-gold)'}
  ];
  let offset = 0;
  const paths = segs.map(s => {
    const frac = total ? s.v/total : 0;
    const len = frac*circ;
    const dash = len+' '+(circ-len);
    const el = '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+s.c+'" stroke-width="11" stroke-dasharray="'+dash+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 '+cx+' '+cy+')"/>';
    offset += len;
    return el;
  }).join('');
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">' +
    (total ? paths : '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="#2a3050" stroke-width="11"/>') +
    '<text x="'+cx+'" y="'+(cy+5)+'" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="20" fill="var(--text-primary)">'+total+'</text>' +
  '</svg>';
}

function renderTable(){
  const wrap = document.getElementById('tableWrap');
  const isActive = STATE.tableMode === 'active';
  const rows = isActive ? STATE.data.activeTickets : STATE.data.recentlyClosedTickets;

  if(!rows.length){
    wrap.innerHTML = '<div class="empty-state"><b>Nothing here yet</b>'+(isActive?'No active requests right now.':'No recently closed tickets to show.')+'</div>';
    return;
  }

  const cols = isActive
    ? [['key','Ticket'],['summary','Summary'],['priority','Priority'],['dueDate','Due Date'],['stage','Current Stage']]
    : [['key','Ticket'],['summary','Summary'],['priority','Priority'],['closedDate','Closed Date'],['translations','Translations']];

  const html = '<table class="data-table"><thead><tr>' +
    cols.map(([k,label]) => '<th data-sort="'+k+'">'+label+'</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map(t => {
      const model = isActive ? buildStageModel(t) : null;
      const stageLabel = model && model.currentOpen ? (STAGE_LABELS[model.currentOpen.type]||model.currentOpen.type) : 'Complete';
      const stageKey = model && model.currentOpen && !model.currentOpen.missing ? model.currentOpen.subtask.key : null;
      const stageLink = jiraLink(stageKey);
      const stageHtml = stageLink ? '<a class="jira-link" href="'+stageLink+'" target="_blank" rel="noopener">'+stageLabel+'</a>' : stageLabel;
      const translations = !isActive ? (t.subtasks||[]).find(s => s.type === 'TRANSLATIONS') : null;
      const translationsPending = translations && translations.status !== 'Closed';
      const tLink = jiraLink(t.key);
      const keyHtml = tLink ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+t.key+'</a>' : t.key;
      return '<tr>' +
        '<td class="primary">'+keyHtml+'</td>' +
        '<td>'+escapeHtml(t.summary)+'</td>' +
        '<td>'+(t.priority||'').replace(/^\d+ - /,'')+'</td>' +
        '<td>'+(isActive ? fmtDate(t.dueDate) : fmtDate(t.closedDate))+'</td>' +
        '<td>'+(isActive ? stageHtml : (translationsPending ? '<span class="pending-note">● Translations pending</span>' : 'All closed'))+'</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
  wrap.innerHTML = html;
}

function renderTranslations(){
  const wrap = document.getElementById('translationsWrap');
  const entries = [];
  (STATE.data.activeTickets || []).forEach(t => {
    const st = (t.subtasks || []).find(s => s.type === 'TRANSLATIONS');
    if(st) entries.push({ ticket: t, st });
  });
  (STATE.data.recentlyClosedTickets || []).forEach(t => {
    const st = (t.subtasks || []).find(s => s.type === 'TRANSLATIONS');
    if(st) entries.push({ ticket: t, st });
  });

  if(!entries.length){
    wrap.innerHTML = '<div class="empty-state"><b>Nothing here yet</b>Translations subtasks will show up here once a ticket needs them.</div>';
    return;
  }

  entries.sort((a,b) => {
    const aOpen = a.st.status !== 'Closed', bOpen = b.st.status !== 'Closed';
    if(aOpen !== bOpen) return aOpen ? -1 : 1;
    return 0;
  });

  const today = todayMid();
  const html = '<table class="data-table"><thead><tr><th>Ticket</th><th>Page</th><th>Subtask</th><th>Status</th><th>Assignee</th><th>Open</th></tr></thead><tbody>' +
    entries.map(({ticket, st}) => {
      const isOpen = st.status !== 'Closed';
      const openDays = (isOpen && st.createdDate) ? businessDaysBetween(atMidnight(st.createdDate), today) : null;
      const tLink = jiraLink(ticket.key);
      const keyHtml = tLink ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+ticket.key+'</a>' : ticket.key;
      const stLink = jiraLink(st.key);
      const stKeyHtml = stLink ? '<a class="jira-link" href="'+stLink+'" target="_blank" rel="noopener">'+st.key+'</a>' : (st.key || '—');
      return '<tr>' +
        '<td class="primary">'+keyHtml+'</td>' +
        '<td>'+escapeHtml(ticket.summary)+'</td>' +
        '<td class="primary">'+stKeyHtml+'</td>' +
        '<td>'+(isOpen ? '<span class="pending-note">● '+escapeHtml(st.status)+'</span>' : 'Closed')+'</td>' +
        '<td>'+(st.assigneeName ? escapeHtml(st.assigneeName) : '—')+'</td>' +
        '<td>'+(openDays !== null ? openDays+'d' : '—')+'</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
  wrap.innerHTML = html;
}

function renderCopy(){
  const wrap = document.getElementById('copyWrap');
  const entries = [];
  (STATE.data.activeTickets || []).forEach(t => {
    const st = (t.subtasks || []).find(s => s.type === 'COPY');
    if(st && st.status !== 'Closed') entries.push({ ticket: t, st });
  });

  if(!entries.length){
    wrap.innerHTML = '<div class="empty-state"><b>Nothing open right now</b>Open Copy sub-tasks will show up here once one exists on an active ticket.</div>';
    return;
  }

  const today = todayMid();
  const html = '<table class="data-table"><thead><tr><th>Ticket</th><th>Page</th><th>Subtask</th><th>Status</th><th>Assignee</th><th>Open</th></tr></thead><tbody>' +
    entries.map(({ticket, st}) => {
      const openDays = st.createdDate ? businessDaysBetween(atMidnight(st.createdDate), today) : null;
      const tLink = jiraLink(ticket.key);
      const keyHtml = tLink ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+ticket.key+'</a>' : ticket.key;
      const stLink = jiraLink(st.key);
      const stKeyHtml = stLink ? '<a class="jira-link" href="'+stLink+'" target="_blank" rel="noopener">'+st.key+'</a>' : (st.key || '—');
      return '<tr>' +
        '<td class="primary">'+keyHtml+'</td>' +
        '<td>'+escapeHtml(ticket.summary)+'</td>' +
        '<td class="primary">'+stKeyHtml+'</td>' +
        '<td><span class="pending-note">● '+escapeHtml(st.status)+'</span></td>' +
        '<td>'+(st.assigneeName ? escapeHtml(st.assigneeName) : '—')+'</td>' +
        '<td>'+(openDays !== null ? openDays+'d' : '—')+'</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
  wrap.innerHTML = html;
}

const LOADING_MESSAGES = [
  'Fetching your board from Jira…',
  'Still working — pulling ticket details…',
  'Jira is a bit slow today, hang tight…',
  'Gathering sub-tasks across your tickets…',
  'Almost there — scoring your board…'
];

async function loadAll(spinning){
  const btn = document.getElementById('refreshBtn');
  if(spinning) btn.classList.add('spinning');
  let msgIndex = 0;
  const statusEl = document.getElementById('loadingStatusText');
  if(statusEl) statusEl.textContent = LOADING_MESSAGES[0];
  const rotateInterval = setInterval(() => {
    msgIndex = Math.min(msgIndex + 1, LOADING_MESSAGES.length - 1);
    const el = document.getElementById('loadingStatusText');
    if(el) el.textContent = LOADING_MESSAGES[msgIndex];
  }, 15000);
  try{
    const data = normalizeFetchedData(await fetchJiraData());
    STATE.data = data;
    document.getElementById('greetingText').textContent =
      data.currentUserFirstName ? 'Good morning, ' + data.currentUserFirstName : 'Good morning';
    document.getElementById('greetingSub').textContent =
      data.activeTickets.length ? data.activeTickets.length + ' active ticket' + (data.activeTickets.length===1?'':'s') + ' on your board.' : 'Nothing active — you are all caught up.';
    renderTicketList();
    renderBottomStrip();
    renderTable();
    renderTranslations();
    renderCopy();
  } catch(err){
    document.getElementById('ticketList').innerHTML =
      '<div class="error-box">Could not load your board: '+escapeHtml(err.message)+'<br><button type="button" id="retryBtn">Retry</button></div>';
    const retry = document.getElementById('retryBtn');
    if(retry) retry.addEventListener('click', () => loadAll(true));
    document.getElementById('greetingSub').textContent = 'Something went wrong loading your board.';
  } finally {
    clearInterval(rotateInterval);
    if(spinning) btn.classList.remove('spinning');
  }
}

const CONFIG_KEYS = ['RA_CREATE_BY','RA_CLOSE_BY','COND_CLOSE_BY','PR_TURNAROUND','TRANSLATIONS_WINDOW'];
const CONFIG_STORAGE_KEY = 'studio-titan-biz-config';

function loadSavedConfig(){
  try{
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if(raw){
      const saved = JSON.parse(raw);
      CONFIG_KEYS.forEach(k => { if(typeof saved[k] === 'number' && saved[k] > 0) BIZ[k] = saved[k]; });
    }
  } catch(err){
    // defaults
  }
}

function populateConfigForm(){
  CONFIG_KEYS.forEach(k => {
    const el = document.getElementById('cfg_' + k);
    if(el) el.value = BIZ[k];
  });
  const note = document.getElementById('configSavedNote');
  if(note) note.textContent = '';
}

function saveConfig(){
  const updated = {};
  for(const k of CONFIG_KEYS){
    const el = document.getElementById('cfg_' + k);
    const val = parseInt(el.value, 10);
    if(!val || val < 1){
      document.getElementById('configSavedNote').textContent = 'Values must be positive whole numbers.';
      document.getElementById('configSavedNote').style.color = 'var(--band-red)';
      return;
    }
    updated[k] = val;
  }
  CONFIG_KEYS.forEach(k => { BIZ[k] = updated[k]; });
  try{
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));
  } catch(err){
    // in-memory still updated
  }
  const note = document.getElementById('configSavedNote');
  note.style.color = 'var(--green)';
  note.textContent = 'Saved — scores updated below.';
  if(STATE.data){
    renderTicketList();
    renderBottomStrip();
    renderTable();
    renderTranslations();
    renderCopy();
  }
}

function resetConfigToDefaults(){
  CONFIG_KEYS.forEach(k => { BIZ[k] = DEFAULT_BIZ[k]; });
  populateConfigForm();
  saveConfig();
}

document.getElementById('refreshBtn').addEventListener('click', () => loadAll(true));
document.getElementById('collapseBtn').addEventListener('click', () => {
  document.getElementById('app').classList.toggle('collapsed');
});
document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    const view = el.getAttribute('data-view');
    document.getElementById('viewSolo').style.display = view === 'solo' ? 'block' : 'none';
    document.getElementById('viewRequests').style.display = view === 'requests' ? 'block' : 'none';
    document.getElementById('viewTranslations').style.display = view === 'translations' ? 'block' : 'none';
    document.getElementById('viewCopy').style.display = view === 'copy' ? 'block' : 'none';
    document.getElementById('viewConfig').style.display = view === 'config' ? 'block' : 'none';
    if(view === 'config') populateConfigForm();
  });
});
document.getElementById('toggleActive').addEventListener('click', () => {
  STATE.tableMode = 'active';
  document.getElementById('toggleActive').classList.add('active');
  document.getElementById('toggleClosed').classList.remove('active');
  renderTable();
});
document.getElementById('toggleClosed').addEventListener('click', () => {
  STATE.tableMode = 'closed';
  document.getElementById('toggleClosed').classList.add('active');
  document.getElementById('toggleActive').classList.remove('active');
  renderTable();
});
document.getElementById('configSaveBtn').addEventListener('click', saveConfig);
document.getElementById('configResetBtn').addEventListener('click', resetConfigToDefaults);

loadSavedConfig();
loadAll(false);

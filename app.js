/* ============================================================
   app.js — wire UI, rendering, and data loading
   ============================================================ */
let STATE = {
  data: null,
  expandedKeys: new Set(),
  tableMode: 'active',
  sortKey: null,
  sortDir: 1,
  calYear: todayMid().getFullYear(),
  calMonth: todayMid().getMonth(),
  horizonFilterDay: null
};

function iconSvg(name){
  const icons = {
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3l9 16H3L12 3zM12 10v4M12 17.5h.01"/></svg>',
    users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M17 8.2a3 3 0 010 5.8M21 19c0-2.5-1.8-4.3-4-5"/></svg>'
  };
  return icons[name] || '';
}

function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;'); }

function renderTicketCard({t, model, scoring}){
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
}

function renderWaitingNudgeCard({t, model, scoring}){
  const nudge = buildWaitingNudge(t, model, scoring);
  if(!nudge) return renderTicketCard({t, model, scoring});

  const tLink = jiraLink(t.key);
  const keyHtml = tLink
    ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(t.key)+'</a>'
    : escapeHtml(t.key);
  const stLink = jiraLink(nudge.subtaskKey);
  const stageHtml = stLink
    ? '<a class="jira-link" href="'+stLink+'" target="_blank" rel="noopener">'+escapeHtml(nudge.blockerType)+'</a>'
    : escapeHtml(nudge.blockerType);

  return '<div class="nudge-card" data-key="'+escapeAttr(t.key)+'" style="--band-color:'+BAND_COLOR[scoring.band]+'">' +
    '<div class="nudge-top">' +
      '<div class="nudge-identity">' +
        '<div class="nudge-key">'+keyHtml+'</div>' +
        '<div class="nudge-summary">'+escapeHtml(t.summary||'')+'</div>' +
      '</div>' +
      '<div class="nudge-due" title="'+escapeAttr(nudge.dueFmt)+'">'+escapeHtml(nudge.dueLabel)+'</div>' +
    '</div>' +
    '<div class="nudge-meta">' +
      '<div class="nudge-meta-item"><span class="nudge-meta-label">Blocker</span><span class="nudge-meta-val">'+stageHtml+'</span></div>' +
      '<div class="nudge-meta-item"><span class="nudge-meta-label">Why</span><span class="nudge-meta-val">'+escapeHtml(nudge.blockerWhy)+'</span></div>' +
      '<div class="nudge-meta-item"><span class="nudge-meta-label">Nudge</span><span class="nudge-meta-val">'+escapeHtml(nudge.assigneeName)+'</span></div>' +
    '</div>' +
    '<div class="nudge-message">' +
      '<div class="nudge-message-label">Ready to send</div>' +
      '<pre class="nudge-text" tabindex="0">'+escapeHtml(nudge.nudgeText)+'</pre>' +
      '<button type="button" class="nudge-copy-btn" data-copy-nudge="'+escapeAttr(t.key)+'">Copy nudge</button>' +
    '</div>' +
  '</div>';
}

function bindNudgeCopyButtons(container){
  container.querySelectorAll('[data-copy-nudge]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest('.nudge-card');
      const textEl = card && card.querySelector('.nudge-text');
      const text = textEl ? textEl.textContent : '';
      if(!text) return;
      const done = () => {
        const prev = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove('copied');
        }, 1400);
      };
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
          done();
          return;
        }
      } catch(_){ /* fall through */ }
      const range = document.createRange();
      range.selectNodeContents(textEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try{ document.execCommand('copy'); done(); } catch(_){ /* selectable still works */ }
    });
  });
}

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
    const lane = classifySoloLane(t, model, scoring);
    const lanes = soloLanesForTicket(t, model, scoring);
    return { t, model, scoring, lane, lanes };
  }).sort((a,b) => b.scoring.score - a.scoring.score);

  // Dual-list: Waiting tickets also land in Action; Attention stays exclusive.
  const byLane = { attention: [], action: [], waiting: [] };
  scored.forEach(item => {
    (item.lanes || [item.lane]).forEach(laneId => {
      (byLane[laneId] || byLane.action).push(item);
    });
  });

  const commentsWarning = STATE.data && STATE.data.commentsWarning
    ? '<div class="comments-warning" role="status">'+escapeHtml(STATE.data.commentsWarning)+'</div>'
    : '';

  container.innerHTML = commentsWarning + SOLO_LANES.map(lane => {
    const items = byLane[lane.id] || [];
    let cards;
    if(!items.length){
      cards = lane.id === 'waiting'
        ? '<div class="lane-empty">Nothing blocked — no nudges needed</div>'
        : '<div class="lane-empty">Nothing in this lane</div>';
    } else if(lane.id === 'waiting'){
      cards = items.map(renderWaitingNudgeCard).join('');
    } else {
      cards = items.map(renderTicketCard).join('');
    }
    return '<div class="solo-lane" data-lane="'+lane.id+'">' +
      '<div class="lane-header">' +
        '<div class="lane-title">'+lane.title+'</div>' +
        '<div class="lane-count">'+items.length+'</div>' +
      '</div>' +
      '<div class="lane-hint">'+lane.hint+'</div>' +
      '<div class="lane-list">'+cards+'</div>' +
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
  bindNudgeCopyButtons(container);
}

function dueDateKey(d){
  if(!d) return null;
  const mid = atMidnight(d);
  if(isNaN(mid.getTime())) return null;
  const y = mid.getFullYear();
  const m = String(mid.getMonth()+1).padStart(2,'0');
  const day = String(mid.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

function isContentTicket(t){
  return !!(t && t.key && String(t.key).toUpperCase().startsWith('CONTENT-'));
}

/** Active WDW/own + CONTENT delivery rows for due calendar / horizon list. */
function horizonSourceTickets(){
  const active = (STATE.data && STATE.data.activeTickets) || [];
  const content = (STATE.data && STATE.data.contentTickets) || [];
  const seen = new Set();
  const out = [];
  active.concat(content).forEach(t => {
    if(!t || !t.key || seen.has(t.key)) return;
    seen.add(t.key);
    out.push(t);
  });
  return out;
}

function ticketsDueOn(tickets, dayKey){
  return tickets.filter(t => dueDateKey(t.dueDate) === dayKey);
}

function dueTodayTickets(tickets){
  return ticketsDueOn(tickets, dueDateKey(todayMid()));
}

/** Due-date ascending list. Omit limit (or pass null) for the full list. */
function horizonTickets(tickets, limit){
  const sorted = tickets
    .filter(t => !!dueDateKey(t.dueDate))
    .slice()
    .sort((a,b) => {
      const da = atMidnight(a.dueDate).getTime();
      const db = atMidnight(b.dueDate).getTime();
      if(da !== db) return da - db;
      return String(a.key||'').localeCompare(String(b.key||''));
    });
  if(limit == null) return sorted;
  return sorted.slice(0, limit);
}

function horizonDueLabel(dueDate){
  const today = todayMid();
  const due = atMidnight(dueDate);
  const days = businessDaysBetween(today, due);
  if(days === 0) return { text: 'Today', cls: 'today' };
  if(days < 0) return { text: Math.abs(days)+'d overdue', cls: 'overdue' };
  return { text: 'In '+days+'d', cls: '' };
}

function resetCalendarToCurrentMonth(){
  const today = todayMid();
  STATE.calYear = today.getFullYear();
  STATE.calMonth = today.getMonth();
}

function shiftCalendarMonth(delta){
  let y = STATE.calYear;
  let m = STATE.calMonth + delta;
  while(m < 0){ m += 12; y -= 1; }
  while(m > 11){ m -= 12; y += 1; }
  STATE.calYear = y;
  STATE.calMonth = m;
}

function bindHorizonInteractions(){
  const root = document.getElementById('dueCalendar');
  if(root){
    const prev = root.querySelector('[data-cal-nav="prev"]');
    const next = root.querySelector('[data-cal-nav="next"]');
    if(prev) prev.addEventListener('click', () => { shiftCalendarMonth(-1); renderHorizonPanel(); });
    if(next) next.addEventListener('click', () => { shiftCalendarMonth(1); renderHorizonPanel(); });
    root.querySelectorAll('.cal-day[data-day-key]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-day-key');
        STATE.horizonFilterDay = key;
        renderHorizonPanel();
      });
    });
  }
  const showAll = document.getElementById('horizonShowAll');
  if(showAll){
    showAll.addEventListener('click', () => {
      STATE.horizonFilterDay = null;
      renderHorizonPanel();
    });
  }
}

function renderHorizonListItems(listTickets){
  return '<div class="horizon-list">'+listTickets.map((t, i) => {
    const due = horizonDueLabel(t.dueDate);
    const tLink = jiraLink(t.key);
    const keyHtml = tLink
      ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(t.key)+'</a>'
      : escapeHtml(t.key);
    const kind = isContentTicket(t) ? 'content' : 'own';
    return '<div class="horizon-item kind-'+kind+'">' +
      '<div class="horizon-rank">'+(i+1)+'</div>' +
      '<div class="horizon-main">' +
        '<div class="horizon-key">'+keyHtml+'</div>' +
        '<div class="horizon-summary">'+escapeHtml(t.summary||'')+'</div>' +
      '</div>' +
      '<div class="horizon-due'+(due.cls ? ' '+due.cls : '')+'" title="'+escapeAttr(fmtDate(t.dueDate))+'">'+due.text+'</div>' +
    '</div>';
  }).join('')+'</div>';
}

function renderHorizonPanel(){
  if(!STATE.data) return;
  const tickets = horizonSourceTickets();
  const today = todayMid();
  const todayKey = dueDateKey(today);
  const dueToday = dueTodayTickets(tickets);
  const allOrdered = horizonTickets(tickets);
  const filterDay = STATE.horizonFilterDay;
  const listTickets = filterDay
    ? allOrdered.filter(t => dueDateKey(t.dueDate) === filterDay)
    : allOrdered;

  const year = STATE.calYear;
  const month = STATE.calMonth;
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = new Date(year, month, 1);
  const startPad = first.getDay(); // Sun=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdays = ['S','M','T','W','T','F','S'];

  const cells = [];
  for(let i = 0; i < startPad; i++){
    cells.push('<div class="cal-day other-month"></div>');
  }
  for(let day = 1; day <= daysInMonth; day++){
    const key = dueDateKey(new Date(year, month, day));
    const due = ticketsDueOn(tickets, key);
    const hasOwn = due.some(t => !isContentTicket(t));
    const hasContent = due.some(t => isContentTicket(t));
    const count = due.length;
    const isToday = key === todayKey;
    const isSelected = filterDay === key;
    const title = count
      ? due.map(t => t.key + (t.summary ? ' — ' + t.summary : '')).join('\n')
      : (isToday ? 'Nothing due today' : 'No launches this day');
    const classes = ['cal-day', 'is-clickable'];
    if(hasOwn) classes.push('has-due-own');
    if(hasContent) classes.push('has-due-content');
    if(isToday) classes.push('is-today');
    if(isSelected) classes.push('is-selected');
    const marks = [];
    if(hasOwn) marks.push('<span class="cal-day-mark mark-own" title="WDW / own"></span>');
    if(hasContent) marks.push('<span class="cal-day-mark mark-content" title="CONTENT"></span>');
    cells.push(
      '<button type="button" class="'+classes.join(' ')+'" data-day-key="'+escapeAttr(key)+'"'+(title ? ' title="'+escapeAttr(title)+'"' : '')+' aria-pressed="'+(isSelected ? 'true' : 'false')+'">' +
        '<span class="cal-day-num">'+day+'</span>' +
        (marks.length ? '<span class="cal-day-marks">'+marks.join('')+'</span>' : '') +
      '</button>'
    );
  }

  const todayNote = dueToday.length
    ? '<div class="cal-today-note"><b>'+dueToday.length+'</b> due today — '+dueToday.map(t => {
        const link = jiraLink(t.key);
        return link ? '<a class="jira-link" href="'+link+'" target="_blank" rel="noopener">'+escapeHtml(t.key)+'</a>' : escapeHtml(t.key);
      }).join(', ')+'</div>'
    : '<div class="cal-today-note empty">Nothing due today</div>';

  const legend =
    '<div class="cal-legend">' +
      '<span class="cal-legend-item"><span class="cal-day-mark mark-own"></span> WDW / own</span>' +
      '<span class="cal-legend-item"><span class="cal-day-mark mark-content"></span> CONTENT</span>' +
    '</div>';

  document.getElementById('dueCalendar').innerHTML =
    '<div class="cal-month-row">' +
      '<button type="button" class="cal-nav-btn" data-cal-nav="prev" aria-label="Previous month">‹</button>' +
      '<div class="cal-month-label">'+escapeHtml(monthLabel)+'</div>' +
      '<button type="button" class="cal-nav-btn" data-cal-nav="next" aria-label="Next month">›</button>' +
    '</div>' +
    '<div class="cal-weekdays">'+weekdays.map(w => '<div class="cal-weekday">'+w+'</div>').join('')+'</div>' +
    '<div class="cal-grid">'+cells.join('')+'</div>' +
    todayNote +
    legend;

  const showAllBtn = document.getElementById('horizonShowAll');
  if(showAllBtn){
    if(filterDay){
      showAllBtn.hidden = false;
      showAllBtn.setAttribute('aria-hidden', 'false');
    } else {
      showAllBtn.hidden = true;
      showAllBtn.setAttribute('aria-hidden', 'true');
    }
  }

  const filterLabel = filterDay ? fmtDate(filterDay) : '';
  if(!listTickets.length){
    document.getElementById('horizonList').innerHTML = filterDay
      ? '<div class="horizon-empty">No launches due on '+escapeHtml(filterLabel)+'</div>'
      : '<div class="horizon-empty">No upcoming due dates on Active or CONTENT tickets</div>';
  } else {
    document.getElementById('horizonList').innerHTML = renderHorizonListItems(listTickets);
  }

  bindHorizonInteractions();
}

function renderBottomStrip(){
  const tickets = STATE.data.activeTickets;
  const scored = tickets.map(t => ({ t, model: buildStageModel(t), scoring: computeScore(t, buildStageModel(t)) }));

  const dueToday = dueTodayTickets(tickets);
  const atRisk = scored.filter(({model}) => model.stageGap > 0);
  const waiting = scored.filter(({t, model}) => isWaitingOnOthers(model, t));

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

function formatPublishEarlyCell(value){
  if(value == null || value === '') return '';
  const s = String(value).trim();
  if(/^yes$/i.test(s)) return '<span class="publish-early yes">Yes</span>';
  if(/^no$/i.test(s)) return '<span class="publish-early no">No</span>';
  return escapeHtml(s);
}

function formatPartnerCell(value){
  if(value == null || value === '') return '';
  return escapeHtml(String(value));
}

function contentDueLabel(dueDate){
  if(!dueDate) return '—';
  const today = todayMid();
  const due = atMidnight(dueDate);
  if(isNaN(due.getTime())) return fmtDate(dueDate);
  const days = businessDaysBetween(today, due);
  const pretty = fmtDate(dueDate);
  if(days === 0) return pretty + ' · Today';
  if(days < 0) return pretty + ' · ' + Math.abs(days) + 'd overdue';
  return pretty;
}

function renderContentListHtml(tickets){
  if(!tickets.length){
    return '<div class="content-empty">No open CONTENT tickets you own for delivery right now.</div>';
  }
  return '<table class="content-table"><thead><tr>' +
    '<th>Key</th><th>Summary</th><th>Status</th><th>Assignee</th><th>Due</th><th>Partner</th>' +
    '</tr></thead><tbody>' +
    tickets.map(t => {
      const tLink = jiraLink(t.key);
      const keyHtml = tLink
        ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(t.key)+'</a>'
        : escapeHtml(t.key);
      return '<tr>' +
        '<td class="primary">'+keyHtml+'</td>' +
        '<td class="content-summary">'+escapeHtml(t.summary || '')+'</td>' +
        '<td>'+escapeHtml(t.status || '—')+'</td>' +
        '<td>'+(t.assigneeName ? escapeHtml(t.assigneeName) : '—')+'</td>' +
        '<td>'+escapeHtml(contentDueLabel(t.dueDate))+'</td>' +
        '<td class="partner-cell">'+(t.partner ? formatPartnerCell(t.partner) : '—')+'</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

/** CONTENT delivery footer under Active Requests only — hidden on Recently Closed. */
function updateContentFooterVisibility(){
  const footer = document.getElementById('contentDeliveryActive');
  if(!footer) return;
  footer.style.display = STATE.tableMode === 'active' ? '' : 'none';
}

/** CONTENT delivery footer under Active & Closed only — never mixed into fire lanes or Solo. */
function renderContentDelivery(){
  const tickets = (STATE.data && STATE.data.contentTickets) || [];
  const html = renderContentListHtml(tickets);
  const active = document.getElementById('contentListActive');
  if(active) active.innerHTML = html;
  updateContentFooterVisibility();
}

function recentlyClosedOwnTickets(){
  return ((STATE.data && STATE.data.recentlyClosedTickets) || []).filter(t => !isContentTicket(t));
}

function renderTable(){
  const wrap = document.getElementById('tableWrap');
  const isActive = STATE.tableMode === 'active';
  // Recently Closed is WDW/own closed only — never CONTENT delivery tickets.
  const rows = isActive ? (STATE.data.activeTickets || []) : recentlyClosedOwnTickets();

  if(!rows.length){
    wrap.innerHTML = '<div class="empty-state"><b>Nothing here yet</b>'+(isActive?'No active requests right now.':'No recently closed tickets to show.')+'</div>';
    return;
  }

  const cols = isActive
    ? [['key','Ticket'],['summary','Summary'],['priority','Priority'],['dueDate','Due Date'],['partner','Partner'],['publishEarly','Publish Early'],['stage','Current Stage']]
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
      if(isActive){
        return '<tr>' +
          '<td class="primary">'+keyHtml+'</td>' +
          '<td>'+escapeHtml(t.summary)+'</td>' +
          '<td>'+(t.priority||'').replace(/^\d+ - /,'')+'</td>' +
          '<td>'+fmtDate(t.dueDate)+'</td>' +
          '<td class="partner-cell">'+formatPartnerCell(t.partner)+'</td>' +
          '<td class="publish-early-cell">'+formatPublishEarlyCell(t.publishEarlyField)+'</td>' +
          '<td>'+stageHtml+'</td>' +
        '</tr>';
      }
      return '<tr>' +
        '<td class="primary">'+keyHtml+'</td>' +
        '<td>'+escapeHtml(t.summary)+'</td>' +
        '<td>'+(t.priority||'').replace(/^\d+ - /,'')+'</td>' +
        '<td>'+fmtDate(t.closedDate)+'</td>' +
        '<td>'+(translationsPending ? '<span class="pending-note">● Translations pending</span>' : 'All closed')+'</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
  wrap.innerHTML = html;
}

function renderTranslations(){
  const wrap = document.getElementById('translationsWrap');
  const entries = [];
  ((STATE.data && STATE.data.activeTickets) || []).forEach(t => {
    const st = (t.subtasks || []).find(s => s.type === 'TRANSLATIONS');
    if(st) entries.push({ ticket: t, st });
  });
  recentlyClosedOwnTickets().forEach(t => {
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

const TEAM_VIEWS = {
  copy: { type: 'COPY', wrapId: 'copyWrap', navId: 'navCopy', label: 'Copy' },
  media: { type: 'MEDIA', wrapId: 'mediaWrap', navId: 'navMedia', label: 'Media' },
  alttext: { type: 'ALTTEXT', wrapId: 'alttextWrap', navId: 'navAlttext', label: 'Alt Text & Captions' }
};

function openTeamSubtaskEntries(type){
  const entries = [];
  ((STATE.data && STATE.data.activeTickets) || []).forEach(t => {
    const st = (t.subtasks || []).find(s => s.type === type);
    if(st && st.status !== 'Closed') entries.push({ ticket: t, st });
  });
  return entries;
}

function renderTeamSubtaskView(viewKey){
  const cfg = TEAM_VIEWS[viewKey];
  if(!cfg) return;
  const wrap = document.getElementById(cfg.wrapId);
  if(!wrap) return;
  const entries = openTeamSubtaskEntries(cfg.type);

  if(!entries.length){
    wrap.innerHTML = '<div class="empty-state"><b>Nothing open right now</b>Open '+escapeHtml(cfg.label)+' sub-tasks will show up here once one exists on an active ticket.</div>';
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

function renderCopy(){ renderTeamSubtaskView('copy'); }
function renderMedia(){ renderTeamSubtaskView('media'); }
function renderAlttext(){ renderTeamSubtaskView('alttext'); }

/** Enable Copy / Media / Alt Text nav only when matching open sub-tasks exist. */
function updateTeamNavAvailability(){
  Object.keys(TEAM_VIEWS).forEach(viewKey => {
    const cfg = TEAM_VIEWS[viewKey];
    const nav = document.getElementById(cfg.navId);
    if(!nav) return;
    const hasMatches = openTeamSubtaskEntries(cfg.type).length > 0;
    nav.classList.toggle('disabled', !hasMatches);
    nav.setAttribute('aria-disabled', hasMatches ? 'false' : 'true');
    if(!hasMatches && nav.classList.contains('active')){
      const solo = document.querySelector('.nav-item[data-view="solo"]');
      if(solo) solo.click();
    }
  });
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
    renderHorizonPanel();
    renderTicketList();
    renderBottomStrip();
    renderTable();
    renderContentDelivery();
    renderTranslations();
    renderCopy();
    renderMedia();
    renderAlttext();
    updateTeamNavAvailability();
  } catch(err){
    document.getElementById('ticketList').innerHTML =
      '<div class="error-box">Could not load your board: '+escapeHtml(err.message)+'<br><button type="button" id="retryBtn">Retry</button></div>';
    const retry = document.getElementById('retryBtn');
    if(retry) retry.addEventListener('click', () => loadAll(true));
    document.getElementById('greetingSub').textContent = 'Something went wrong loading your board.';
    const emptyContent = '<div class="content-empty">Could not load CONTENT tickets.</div>';
    const active = document.getElementById('contentListActive');
    if(active) active.innerHTML = emptyContent;
    updateTeamNavAvailability();
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
    renderHorizonPanel();
    renderTicketList();
    renderBottomStrip();
    renderTable();
    renderContentDelivery();
    renderTranslations();
    renderCopy();
    renderMedia();
    renderAlttext();
    updateTeamNavAvailability();
  }
}

function resetConfigToDefaults(){
  CONFIG_KEYS.forEach(k => { BIZ[k] = DEFAULT_BIZ[k]; });
  populateConfigForm();
  saveConfig();
}

document.getElementById('refreshBtn').addEventListener('click', () => loadAll(true));
document.getElementById('collapseBtn').addEventListener('click', () => {
  const app = document.getElementById('app');
  app.classList.toggle('collapsed');
  const collapsed = app.classList.contains('collapsed');
  const btn = document.getElementById('collapseBtn');
  const label = btn.querySelector('.label');
  if(label) label.textContent = collapsed ? 'Expand' : 'Collapse';
  btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  btn.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
});
document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => {
    if(el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true') return;
    document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    const view = el.getAttribute('data-view');
    const setView = (id, on) => { const node = document.getElementById(id); if(node) node.style.display = on ? 'block' : 'none'; };
    setView('viewSolo', view === 'solo');
    setView('viewHorizon', view === 'horizon');
    setView('viewRequests', view === 'requests');
    setView('viewTranslations', view === 'translations');
    setView('viewCopy', view === 'copy');
    setView('viewMedia', view === 'media');
    setView('viewAlttext', view === 'alttext');
    setView('viewConfig', view === 'config');
    if(view === 'horizon'){
      resetCalendarToCurrentMonth();
      STATE.horizonFilterDay = null;
      if(STATE.data) renderHorizonPanel();
    }
    if(view === 'config') populateConfigForm();
  });
});
document.getElementById('toggleActive').addEventListener('click', () => {
  STATE.tableMode = 'active';
  document.getElementById('toggleActive').classList.add('active');
  document.getElementById('toggleClosed').classList.remove('active');
  renderTable();
  updateContentFooterVisibility();
});
document.getElementById('toggleClosed').addEventListener('click', () => {
  STATE.tableMode = 'closed';
  document.getElementById('toggleClosed').classList.add('active');
  document.getElementById('toggleActive').classList.remove('active');
  renderTable();
  updateContentFooterVisibility();
});
document.getElementById('configSaveBtn').addEventListener('click', saveConfig);
document.getElementById('configResetBtn').addEventListener('click', resetConfigToDefaults);

loadSavedConfig();
loadAll(false);

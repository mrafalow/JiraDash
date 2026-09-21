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
  horizonFilterDay: null,
  atRiskItems: [],
  waitingItems: []
};

function iconSvg(name){
  const icons = {
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3l9 16H3L12 3zM12 10v4M12 17.5h.01"/></svg>',
    users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M17 8.2a3 3 0 010 5.8M21 19c0-2.5-1.8-4.3-4-5"/></svg>',
    translate: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9S9.5 5.8 12 3z"/></svg>',
    queue: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2.2"/></svg>'
  };
  return icons[name] || '';
}

/** CONTENT portfolio — same set as Active & Closed “OWNED BY MANAGED SERVICES”. */
function msQueueTickets(){
  return (STATE.data && STATE.data.contentTickets) || [];
}

function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;'); }

/** WDW Active + MS Solo inject (CONTENT assigned + RA) for fire lanes / strip. */
function soloSourceTickets(){
  const active = (STATE.data && STATE.data.activeTickets) || [];
  const ms = (STATE.data && STATE.data.msSoloTickets) || [];
  return active.concat(ms);
}

function msBadgeHtml(ticket){
  if(!isManagedServicesTicket(ticket)) return '';
  return '<span class="ms-badge" title="Managed Services — truncated pipeline">MS</span>';
}

/** Hard MS stall card — no pipeline score; click opens Jira. */
function renderMsStallCard(t){
  const reason = msStallReason(t);
  const dueLabel = msStallCalendarDueLabel(t);
  const priorityShort = (t.priority || '').replace(/^\d+ - /,'');
  const tLink = jiraLink(t.key);
  const summaryHtml = tLink
    ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(t.summary || t.key)+'</a>'
    : escapeHtml(t.summary || t.key);
  const openHref = tLink || '';
  return '<div class="ticket-card ms-ticket ms-stall-card" style="--band-color:var(--band-orange)" data-key="'+escapeAttr(t.key)+'" data-ms-stall="1">' +
    '<div class="ticket-row"'+(openHref ? ' data-ms-stall-open="'+escapeAttr(openHref)+'"' : '')+'>' +
      '<div class="score-stack">' +
        '<div class="score-badge ms-stall-mark" style="background:var(--band-orange-bg);color:var(--band-orange)" title="MS stall — not scored">—</div>' +
        '<span class="ms-badge" title="Still with Managed Services">MS</span>' +
      '</div>' +
      '<div class="ticket-main">' +
        '<div class="ticket-summary">'+summaryHtml+'</div>' +
        '<div class="ticket-tag">'+escapeHtml(reason)+'</div>' +
      '</div>' +
      '<div class="ticket-meta">' +
        '<div class="meta-col">Due<div class="val">'+escapeHtml(dueLabel)+'</div></div>' +
        (priorityShort ? '<div class="priority-chip" style="background:var(--band-orange-bg);color:var(--band-orange)">'+escapeHtml(priorityShort)+'</div>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

/** PR review card — open PR assigned to you; urgency from 1-day SLA. */
function renderPrReviewCard({t, pr}){
  const reason = prReviewReason(pr);
  const dueLabel = prReviewDueLabel(pr);
  const days = prReviewDaysUntilDue(pr);
  const urgent = typeof days === 'number' && days <= 0;
  const bandColor = urgent ? 'var(--band-red)' : 'var(--band-orange)';
  const bandBg = urgent ? 'var(--band-red-bg)' : 'var(--band-orange-bg)';
  const priorityShort = (t.priority || '').replace(/^\d+ - /,'');
  const isExpanded = STATE.expandedKeys.has(t.key);
  const tLink = jiraLink(t.key);
  const prLink = jiraLink(pr && pr.key);
  const summaryHtml = tLink
    ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(t.summary || t.key)+'</a>'
    : escapeHtml(t.summary || t.key);
  const prKeyHtml = prLink
    ? '<a class="jira-link" href="'+prLink+'" target="_blank" rel="noopener">'+escapeHtml(pr.key || 'PR')+'</a>'
    : escapeHtml((pr && pr.key) || 'PR');

  const subtaskRows = (t.subtasks || []).map(st => {
    const color = st.status === 'Closed' ? 'var(--green)' : (st.assigneeIsCurrentUser === false ? 'var(--band-orange)' : 'var(--band-blue)');
    const label = STAGE_LABELS[st.type] || st.type;
    const stLink = jiraLink(st.key);
    const labelHtml = stLink ? '<a class="jira-link" href="'+stLink+'" target="_blank" rel="noopener">'+label+'</a>' : label;
    const isThisPr = pr && st.key === pr.key;
    let tagText = st.status === 'Closed' ? 'Done' : (st.assigneeIsCurrentUser === false ? 'Waiting on ' + (st.assigneeName || 'other') : 'In progress');
    if(isThisPr && st.status !== 'Closed') tagText = 'Your review · 1-day SLA';
    return '<div class="subtask-row'+(isThisPr ? ' pr-review-row' : '')+'">' +
      '<span class="status-dot" style="background:'+color+'"></span>' +
      '<span class="subtask-type">'+labelHtml+'</span>' +
      '<span class="subtask-tag">'+tagText+'</span>' +
      '<span class="subtask-assignee">'+(st.assigneeName || '')+'</span>' +
      '</div>';
  }).join('');

  return '<div class="ticket-card pr-review-card'+(isExpanded?' expanded':'')+(isManagedServicesTicket(t)?' ms-ticket':'')+'" style="--band-color:'+bandColor+'" data-key="'+escapeAttr(t.key)+'" data-pr-review="1">' +
    '<div class="ticket-row" data-toggle="'+escapeAttr(t.key)+'">' +
      '<div class="score-stack">' +
        '<div class="score-badge" style="background:'+bandBg+';color:'+bandColor+'" title="PR review — 1-day SLA">PR</div>' +
        '<span class="pr-badge" title="Peer review assigned to you">Review</span>' +
        msBadgeHtml(t) +
      '</div>' +
      '<div class="ticket-main">' +
        '<div class="ticket-summary">'+summaryHtml+'</div>' +
        '<div class="ticket-tag">'+escapeHtml(reason)+' · '+prKeyHtml+'</div>' +
      '</div>' +
      '<div class="ticket-meta">' +
        '<div class="meta-col">Review<div class="val">'+escapeHtml(dueLabel)+'</div></div>' +
        (priorityShort ? '<div class="priority-chip" style="background:'+bandBg+';color:'+bandColor+'">'+escapeHtml(priorityShort)+'</div>' : '') +
      '</div>' +
      '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>' +
    '</div>' +
    (isExpanded ? '<div class="subtask-list">'+subtaskRows+'</div>' : '') +
  '</div>';
}

function bindMsStallOpen(container){
  container.querySelectorAll('[data-ms-stall-open]').forEach(el => {
    el.addEventListener('click', (e) => {
      if(e.target.closest('a')) return;
      const href = el.getAttribute('data-ms-stall-open');
      if(href) window.open(href, '_blank', 'noopener');
    });
  });
}

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

  return '<div class="ticket-card'+(isExpanded?' expanded':'')+(isManagedServicesTicket(t)?' ms-ticket':'')+'" style="--band-color:'+BAND_COLOR[scoring.band]+'" data-key="'+t.key+'">' +
    '<div class="ticket-row" data-toggle="'+t.key+'">' +
      '<div class="score-stack">' +
        '<div class="score-badge" style="background:'+BAND_BG[scoring.band]+';color:'+BAND_COLOR[scoring.band]+'">'+scoring.score+'</div>' +
        msBadgeHtml(t) +
      '</div>' +
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

  return '<div class="nudge-card'+(isManagedServicesTicket(t)?' ms-ticket':'')+'" data-key="'+escapeAttr(t.key)+'" style="--band-color:'+BAND_COLOR[scoring.band]+'">' +
    '<div class="nudge-top">' +
      '<div class="nudge-identity">' +
        '<div class="nudge-key">'+keyHtml+msBadgeHtml(t)+'</div>' +
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
  const tickets = soloSourceTickets();
  const msStalls = collectMsStallTickets(STATE.data);
  const prReviews = collectPrReviewTickets(tickets);
  if(!tickets.length && !msStalls.length){
    container.innerHTML = '<div class="empty-state"><b>Nothing in focus right now</b>New requests will show up here the moment they are assigned to you.</div>';
    return;
  }
  const scored = tickets.map(t => {
    const model = buildStageModel(t);
    const scoring = computeScore(t, model);
    const lane = classifySoloLane(t, model, scoring);
    const lanes = soloLanesForTicket(t, model, scoring);
    return { t, model, scoring, lane, lanes };
  }).sort((a,b) => b.scoring.score - a.scoring.score);

  // Dual-list: Attention+Waiting OK; Waiting+Action only when not Needs Attention.
  const byLane = { attention: [], action: [], waiting: [], 'pr-reviews': [] };
  scored.forEach(item => {
    (item.lanes || [item.lane]).forEach(laneId => {
      (byLane[laneId] || byLane.action).push(item);
    });
  });

  // MS stalls (still with MS, due ≤10 calendar days) → Needs Attention; sort by due; no pipeline score.
  const stallKeys = new Set(msStalls.map(t => t.key));
  byLane.attention = byLane.attention.filter(item => !stallKeys.has(item.t.key));
  const stallItems = msStalls.map(t => ({ t, msStall: true }));

  // PR reviews lane — dedicated list; omit section when empty. Still dual-list in other lanes.
  byLane['pr-reviews'] = prReviews;

  const commentsWarning = STATE.data && STATE.data.commentsWarning
    ? '<div class="comments-warning" role="status">'+escapeHtml(STATE.data.commentsWarning)+'</div>'
    : '';

  container.innerHTML = commentsWarning + SOLO_LANES.map(lane => {
    const scoredItems = byLane[lane.id] || [];
    const items = lane.id === 'attention' ? stallItems.concat(scoredItems) : scoredItems;
    if(lane.omitIfEmpty && !items.length) return '';
    let cards;
    if(!items.length){
      cards = lane.id === 'waiting'
        ? '<div class="lane-empty">Nothing blocked — no nudges needed</div>'
        : '<div class="lane-empty">Nothing in this lane</div>';
    } else if(lane.id === 'waiting'){
      cards = items.map(renderWaitingNudgeCard).join('');
    } else if(lane.id === 'attention'){
      cards = items.map(item => item.msStall ? renderMsStallCard(item.t) : renderTicketCard(item)).join('');
    } else if(lane.id === 'pr-reviews'){
      cards = items.map(item => renderPrReviewCard(item)).join('');
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
  bindMsStallOpen(container);
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

function shortHorizonTicketKey(key){
  if(!key) return '';
  return String(key).replace(/^WDW-/i, 'W').replace(/^CONTENT-/i, 'MS');
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
    root.querySelectorAll('.cal-day-chip').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
    });
  }
  const showAll = document.getElementById('horizonShowAll');
  if(showAll){
    showAll.onclick = () => {
      STATE.horizonFilterDay = null;
      renderHorizonPanel();
    };
  }
}

function renderHorizonListItems(listTickets){
  return '<div class="horizon-list">'+listTickets.map((t, i) => {
    const due = horizonDueLabel(t.dueDate);
    const tLink = jiraLink(t.key);
    const shortKey = shortHorizonTicketKey(t.key);
    const keyHtml = tLink
      ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(shortKey)+'</a>'
      : escapeHtml(shortKey);
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
    const visible = due.slice(0, 1);
    const overflow = due.length - visible.length;
    const chips = visible.map(t => {
      const kind = isContentTicket(t) ? 'content' : 'own';
      const label = shortHorizonTicketKey(t.key);
      const link = jiraLink(t.key);
      if(link){
        return '<a class="cal-day-chip kind-'+kind+' jira-link" href="'+escapeAttr(link)+'" target="_blank" rel="noopener">'+escapeHtml(label)+'</a>';
      }
      return '<span class="cal-day-chip kind-'+kind+'">'+escapeHtml(label)+'</span>';
    }).join('');
    const overflowHtml = overflow > 0
      ? '<span class="cal-day-more">+'+overflow+' more</span>'
      : '';
    cells.push(
      '<div class="'+classes.join(' ')+'" data-day-key="'+escapeAttr(key)+'" role="button" tabindex="0"'+(title ? ' title="'+escapeAttr(title)+'"' : '')+' aria-pressed="'+(isSelected ? 'true' : 'false')+'">' +
        '<span class="cal-day-num">'+day+'</span>' +
        (chips || overflowHtml ? '<span class="cal-day-chips">'+chips+overflowHtml+'</span>' : '') +
      '</div>'
    );
  }

  const todayNote = dueToday.length
    ? '<div class="cal-today-note"><b>'+dueToday.length+'</b> due today — '+dueToday.map(t => {
        const link = jiraLink(t.key);
        const sk = shortHorizonTicketKey(t.key);
        return link ? '<a class="jira-link" href="'+link+'" target="_blank" rel="noopener">'+escapeHtml(sk)+'</a>' : escapeHtml(sk);
      }).join(', ')+'</div>'
    : '<div class="cal-today-note empty">Nothing due today</div>';

  const legend =
    '<div class="cal-legend">' +
      '<span class="cal-legend-item"><span class="cal-day-mark mark-own"></span> WDW</span>' +
      '<span class="cal-legend-item"><span class="cal-day-mark mark-content"></span> MS</span>' +
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
      : '<div class="horizon-empty">No upcoming due dates on WDW or MS tickets</div>';
  } else {
    document.getElementById('horizonList').innerHTML = renderHorizonListItems(listTickets);
  }

  bindHorizonInteractions();
}

function renderBottomStrip(){
  const tickets = soloSourceTickets();
  const scored = tickets.map(t => {
    const model = buildStageModel(t);
    return { t, model, scoring: computeScore(t, model) };
  });

  const dueToday = dueTodayTickets(tickets);
  const atRisk = scored
    .filter(({model}) => model.stageGap > 0)
    .slice()
    .sort((a,b) => {
      const scoreDiff = (b.scoring.score||0) - (a.scoring.score||0);
      if(scoreDiff) return scoreDiff;
      const gapDiff = (b.model.stageGap||0) - (a.model.stageGap||0);
      if(gapDiff) return gapDiff;
      return String(a.t.key||'').localeCompare(String(b.t.key||''));
    });
  STATE.atRiskItems = atRisk;
  const waiting = scored.filter(({t, model}) => isWaitingOnOthers(model, t));
  STATE.waitingItems = waiting;

  let publishState = 'off';
  if(dueToday.length){
    const anyUnapproved = dueToday.some(t => {
      const wf = (t.subtasks||[]).find(s => s.type === 'WF');
      return !wf || wf.status !== 'Closed';
    });
    publishState = anyUnapproved ? 'red' : 'green';
  }

  const translationsOpen = openTranslationsEntries().length;
  const msQueue = msQueueTickets();
  const msQueueCount = msQueue.length;
  const msCheckins = collectMsCheckinTickets(STATE.data);
  const msCheckinCount = msCheckins.length;
  const msQueueSub = msCheckinCount
    ? 'Red flag · '+msCheckinCount+' idle after handoff'
    : (msQueueCount ? 'In MS portfolio' : 'In queue');
  const msQueueAria = msCheckinCount
    ? 'MS Queue — '+msQueueCount+' in portfolio; '+msCheckinCount+' soft red flag'+(msCheckinCount===1?'':'s')+' (3+ calendar days since MS handoff, no progress). Activate to open Owned by Managed Services.'
    : (msQueueCount
      ? 'MS Queue — '+msQueueCount+' ticket'+(msQueueCount===1?'':'s')+' in MS portfolio. Activate to open Active & Closed Owned by Managed Services.'
      : 'MS Queue — in queue');

  document.getElementById('bottomStripWrap').style.display = 'block';
  document.getElementById('bottomStrip').innerHTML =
    '<div class="strip-card publish-light-card">' +
      '<svg class="light mouse-head'+(publishState==='off'?'':' '+publishState)+'" viewBox="0 0 46 46" width="46" height="46" aria-hidden="true" focusable="false">' +
        '<circle class="mouse-ear" cx="11" cy="12" r="9"/>' +
        '<circle class="mouse-ear" cx="35" cy="12" r="9"/>' +
        '<circle class="mouse-face" cx="23" cy="28" r="14"/>' +
      '</svg>' +
      '<div class="publish-light-label">'+(publishState==='off'?'Nothing publishing today':publishState==='green'?'Clear to publish':'Unlock needed — go now')+'</div>' +
    '</div>' +
    strip('warning', 'var(--band-orange)', 'At Risk', atRisk.length, atRisk.length ? 'Behind expected pace' : 'All on pace', {
      id: 'atRiskStrip',
      clickable: atRisk.length > 0,
      ariaLabel: atRisk.length
        ? 'At Risk — '+atRisk.length+' ticket'+(atRisk.length===1?'':'s')+' behind expected pace. Activate to jump to ticket'+(atRisk.length===1?'':'s')+'.'
        : 'At Risk — all on pace'
    }) +
    strip('queue', msCheckinCount ? 'var(--band-red)' : 'var(--band-blue)', 'MS Queue', msQueueCount, msQueueSub, {
      id: 'msQueueStrip',
      clickable: msQueueCount > 0,
      clickableAccent: 'blue',
      ariaLabel: msQueueAria,
      extraClass: msCheckinCount ? ' ms-checkin-soft' : ''
    }) +
    strip('users', 'var(--band-blue)', 'Waiting on Others', waiting.length, waiting.length ? 'Sitting with someone else' : 'Nothing stalled', {
      id: 'waitingStrip',
      clickable: waiting.length > 0,
      clickableAccent: 'blue',
      ariaLabel: waiting.length
        ? 'Waiting on Others — '+waiting.length+' ticket'+(waiting.length===1?'':'s')+' sitting with someone else. Activate to jump to Waiting section.'
        : 'Waiting on Others — nothing stalled'
    }) +
    strip('translate', 'var(--band-blue)', 'Translations', translationsOpen, translationsOpen ? 'Open sub-tasks' : 'Nothing open', {
      id: 'translationsStrip',
      clickable: translationsOpen > 0,
      clickableAccent: 'blue',
      ariaLabel: translationsOpen
        ? 'Translations — '+translationsOpen+' open. Activate to open Translations view.'
        : 'Translations — nothing open'
    });

  bindAtRiskStrip();
  bindMsQueueStrip();
  bindWaitingStrip();
  bindTranslationsStrip();
}
function strip(icon, color, label, value, sub, opts){
  opts = opts || {};
  const clickable = !!opts.clickable;
  const idAttr = opts.id ? ' id="'+escapeAttr(opts.id)+'"' : '';
  const accentClass = clickable && opts.clickableAccent === 'blue' ? ' strip-card-clickable-blue' : '';
  const extraClass = opts.extraClass || '';
  const classes = 'strip-card'+(clickable ? ' strip-card-clickable' : '')+accentClass+extraClass;
  const a11y = clickable
    ? ' role="button" tabindex="0" aria-label="'+escapeAttr(opts.ariaLabel || label)+'"'
    : (opts.id ? ' aria-disabled="true"' : '');
  return '<div class="'+classes+'"'+idAttr+a11y+'>' +
    '<div class="metric-icon" style="background:transparent;color:'+color+'">'+iconSvg(icon)+'</div>' +
    '<div class="metric-label">'+label+'</div>' +
    '<div class="metric-value">'+value+'</div>' +
    '<div class="metric-sub" style="color:'+color+'">'+sub+'</div>' +
  '</div>';
}

function ensureSoloView(){
  const soloNav = document.querySelector('.nav-item[data-view="solo"]');
  if(soloNav && !soloNav.classList.contains('active')) soloNav.click();
}

/** Prefer Needs Attention, then PR reviews, then Waiting, then Action when dual-listed. */
function findSoloTicketCard(key){
  if(!key) return null;
  const list = document.getElementById('ticketList');
  if(!list) return null;
  const laneOrder = ['attention', 'pr-reviews', 'waiting', 'action'];
  for(let i = 0; i < laneOrder.length; i++){
    const lane = list.querySelector('.solo-lane[data-lane="'+laneOrder[i]+'"]');
    if(!lane) continue;
    const cards = lane.querySelectorAll('.ticket-card[data-key], .nudge-card[data-key]');
    for(let j = 0; j < cards.length; j++){
      if(cards[j].getAttribute('data-key') === key) return cards[j];
    }
  }
  const all = list.querySelectorAll('.ticket-card[data-key], .nudge-card[data-key]');
  for(let k = 0; k < all.length; k++){
    if(all[k].getAttribute('data-key') === key) return all[k];
  }
  return null;
}

function highlightTicketCard(card){
  if(!card) return;
  card.classList.remove('flash-highlight');
  void card.offsetWidth;
  card.classList.add('flash-highlight');
  const clear = () => card.classList.remove('flash-highlight');
  card.addEventListener('animationend', clear, { once: true });
  setTimeout(clear, 2200);
}

function scrollToAtRiskTicket(key){
  ensureSoloView();
  closeAtRiskPopover();
  closeAtRiskModal();
  const card = findSoloTicketCard(key);
  if(!card) return false;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightTicketCard(card);
  return true;
}

function atRiskWhyText(item){
  const gap = item && item.model ? item.model.stageGap : 0;
  const score = item && item.scoring ? item.scoring.score : '';
  const parts = [];
  if(gap > 0) parts.push(gap + ' stage'+(gap===1?'':'s')+' behind');
  if(score !== '' && score != null) parts.push('score '+score);
  return parts.join(' · ') || 'Behind pace';
}

function atRiskDueText(item){
  const due = item && item.t && item.t.dueDate;
  if(!due) return 'No due date';
  const days = item.scoring && item.scoring.daysUntilDue;
  if(days === 0) return 'Due today';
  if(typeof days === 'number' && days < 0) return Math.abs(days)+'d overdue';
  if(typeof days === 'number') return 'Due in '+days+'d';
  return 'Due '+fmtDate(due);
}

function renderAtRiskListRows(items){
  return items.map(item => {
    const key = item.t.key || '';
    return '<button type="button" class="at-risk-row" data-at-risk-key="'+escapeAttr(key)+'">' +
      '<div class="at-risk-row-main">' +
        '<div class="at-risk-row-key">'+escapeHtml(key)+'</div>' +
        '<div class="at-risk-row-summary">'+escapeHtml(item.t.summary||'')+'</div>' +
      '</div>' +
      '<div class="at-risk-row-meta">' +
        '<span class="at-risk-why">'+escapeHtml(atRiskWhyText(item))+'</span>' +
        '<span class="at-risk-due">'+escapeHtml(atRiskDueText(item))+'</span>' +
      '</div>' +
    '</button>';
  }).join('');
}

function closeAtRiskPopover(){
  const pop = document.getElementById('atRiskPopover');
  if(pop){
    pop.hidden = true;
    pop.setAttribute('aria-hidden', 'true');
    pop.innerHTML = '';
  }
  document.removeEventListener('mousedown', onAtRiskPopoverOutside, true);
  document.removeEventListener('keydown', onAtRiskPopoverEsc, true);
}

function onAtRiskPopoverOutside(e){
  const pop = document.getElementById('atRiskPopover');
  const strip = document.getElementById('atRiskStrip');
  if(!pop || pop.hidden) return;
  if(pop.contains(e.target) || (strip && strip.contains(e.target))) return;
  closeAtRiskPopover();
}

function onAtRiskPopoverEsc(e){
  if(e.key === 'Escape') closeAtRiskPopover();
}

function openAtRiskPopover(items, anchor){
  const pop = document.getElementById('atRiskPopover');
  if(!pop || !anchor) return;
  pop.innerHTML =
    '<div class="at-risk-popover-title">At Risk</div>' +
    '<div class="at-risk-popover-list">'+renderAtRiskListRows(items)+'</div>';
  pop.hidden = false;
  pop.setAttribute('aria-hidden', 'false');

  const rect = anchor.getBoundingClientRect();
  const width = Math.max(280, Math.min(360, rect.width + 40));
  pop.style.width = width+'px';
  let left = rect.left;
  let top = rect.bottom + 8;
  pop.style.left = left+'px';
  pop.style.top = top+'px';
  const pr = pop.getBoundingClientRect();
  if(pr.right > window.innerWidth - 12){
    left = Math.max(12, window.innerWidth - pr.width - 12);
    pop.style.left = left+'px';
  }
  if(pr.bottom > window.innerHeight - 12){
    top = Math.max(8, rect.top - pr.height - 8);
    pop.style.top = top+'px';
  }

  pop.querySelectorAll('[data-at-risk-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      scrollToAtRiskTicket(btn.getAttribute('data-at-risk-key'));
    });
  });
  document.addEventListener('mousedown', onAtRiskPopoverOutside, true);
  document.addEventListener('keydown', onAtRiskPopoverEsc, true);
  const first = pop.querySelector('[data-at-risk-key]');
  if(first) first.focus();
}

function closeAtRiskModal(){
  const modal = document.getElementById('atRiskModal');
  if(!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', onAtRiskModalEsc, true);
}

function onAtRiskModalEsc(e){
  if(e.key === 'Escape') closeAtRiskModal();
}

function openAtRiskModal(items){
  const modal = document.getElementById('atRiskModal');
  const body = document.getElementById('atRiskModalBody');
  const title = document.getElementById('atRiskModalTitle');
  if(!modal || !body) return;
  closeAtRiskPopover();
  if(title) title.textContent = 'At Risk — '+items.length+' tickets';
  body.innerHTML = '<div class="at-risk-modal-list">'+renderAtRiskListRows(items)+'</div>';
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  body.querySelectorAll('[data-at-risk-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      scrollToAtRiskTicket(btn.getAttribute('data-at-risk-key'));
    });
  });
  document.addEventListener('keydown', onAtRiskModalEsc, true);
  const closeBtn = document.getElementById('atRiskModalClose');
  if(closeBtn) closeBtn.focus();
}

function handleAtRiskActivate(){
  const items = STATE.atRiskItems || [];
  if(!items.length) return;
  const stripEl = document.getElementById('atRiskStrip');
  if(items.length === 1){
    scrollToAtRiskTicket(items[0].t.key);
    return;
  }
  if(items.length === 2){
    const pop = document.getElementById('atRiskPopover');
    if(pop && !pop.hidden){
      closeAtRiskPopover();
      return;
    }
    openAtRiskPopover(items, stripEl);
    return;
  }
  openAtRiskModal(items);
}

function bindAtRiskStrip(){
  const el = document.getElementById('atRiskStrip');
  if(!el) return;
  if(!el.classList.contains('strip-card-clickable')) return;
  el.addEventListener('click', handleAtRiskActivate);
  el.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      handleAtRiskActivate();
    }
  });
}

/** Waiting-lane cards only — never Needs Attention / Action dual-listed copies. */
function getWaitingLaneCards(){
  const list = document.getElementById('ticketList');
  if(!list) return [];
  const lane = list.querySelector('.solo-lane[data-lane="waiting"]');
  if(!lane) return [];
  return Array.from(lane.querySelectorAll('.nudge-card[data-key], .ticket-card[data-key]'));
}

function findWaitingTicketCard(key){
  if(!key) return null;
  const cards = getWaitingLaneCards();
  for(let i = 0; i < cards.length; i++){
    if(cards[i].getAttribute('data-key') === key) return cards[i];
  }
  return null;
}

function scrollToWaitingOnOthers(keys){
  ensureSoloView();
  const list = document.getElementById('ticketList');
  const lane = list && list.querySelector('.solo-lane[data-lane="waiting"]');
  if(!lane) return false;

  let cards;
  if(keys && keys.length === 1){
    const one = findWaitingTicketCard(keys[0]);
    cards = one ? [one] : getWaitingLaneCards();
  } else if(keys && keys.length > 1){
    cards = keys.map(findWaitingTicketCard).filter(Boolean);
    if(!cards.length) cards = getWaitingLaneCards();
  } else {
    cards = getWaitingLaneCards();
  }

  if(cards.length === 1){
    cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    lane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  cards.forEach(highlightTicketCard);
  return cards.length > 0;
}

function handleWaitingActivate(){
  const items = STATE.waitingItems || [];
  if(!items.length) return;
  const keys = items.map(item => item.t && item.t.key).filter(Boolean);
  scrollToWaitingOnOthers(keys);
}

function bindWaitingStrip(){
  const el = document.getElementById('waitingStrip');
  if(!el) return;
  if(!el.classList.contains('strip-card-clickable')) return;
  el.addEventListener('click', handleWaitingActivate);
  el.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      handleWaitingActivate();
    }
  });
}

function handleTranslationsActivate(){
  if(!openTranslationsEntries().length) return;
  const nav = document.getElementById('navTranslations') ||
    document.querySelector('.nav-item[data-view="translations"]');
  if(nav && !nav.classList.contains('disabled') && nav.getAttribute('aria-disabled') !== 'true'){
    nav.click();
  }
}

function bindTranslationsStrip(){
  const el = document.getElementById('translationsStrip');
  if(!el) return;
  if(!el.classList.contains('strip-card-clickable')) return;
  el.addEventListener('click', handleTranslationsActivate);
  el.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      handleTranslationsActivate();
    }
  });
}

function ensureActiveRequestsView(){
  const nav = document.querySelector('.nav-item[data-view="requests"]');
  if(nav && !nav.classList.contains('active')) nav.click();
  if(STATE.tableMode !== 'active'){
    const toggle = document.getElementById('toggleActive');
    if(toggle) toggle.click();
  }
}

function highlightMsSection(section){
  if(!section) return;
  section.classList.remove('flash-highlight');
  void section.offsetWidth;
  section.classList.add('flash-highlight');
  const clear = () => section.classList.remove('flash-highlight');
  section.addEventListener('animationend', clear, { once: true });
  setTimeout(clear, 2200);
}

function scrollToMsQueueSection(){
  ensureActiveRequestsView();
  const section = document.getElementById('contentDeliveryActive');
  if(!section) return false;
  // View/toggle may have just become visible — scroll after layout.
  requestAnimationFrame(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlightMsSection(section);
  });
  return true;
}

function handleMsQueueActivate(){
  if(!msQueueTickets().length) return;
  scrollToMsQueueSection();
}

function bindMsQueueStrip(){
  const el = document.getElementById('msQueueStrip');
  if(!el) return;
  if(!el.classList.contains('strip-card-clickable')) return;
  el.addEventListener('click', handleMsQueueActivate);
  el.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      handleMsQueueActivate();
    }
  });
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

const MS_PROGRESS_CHIPS = [
  { id: 'status', label: 'Status', onKey: 'statusMoved', reason: 'Status moved' },
  { id: 'subtask', label: 'Subtask', onKey: 'hasSub', reason: 'Subtask created' },
  { id: 'ra', label: 'RA', onKey: 'hasRa', reason: 'RA created' }
];

function renderContentMotionCell(ticket){
  const motion = contentMotionState(ticket);
  const tip = motion.reasons.length ? motion.reasons.join(' · ') : 'No progress yet';
  const litLabels = MS_PROGRESS_CHIPS.filter(c => motion[c.onKey]).map(c => c.label);
  const aria = litLabels.length
    ? 'Progress: ' + litLabels.join(', ') + ' on'
    : 'Progress: Status, Subtask, and RA off';
  const chips = MS_PROGRESS_CHIPS.map(c => {
    const on = !!motion[c.onKey];
    return '<span class="ms-progress-chip'+(on?' is-on':'')+'" data-chip="'+c.id+'" title="'+escapeAttr(c.reason+(on?'':' — not yet'))+'">'+
      escapeHtml(c.label)+
    '</span>';
  }).join('');
  return '<span class="ms-progress" title="'+escapeAttr(tip)+'" role="img" aria-label="'+escapeAttr(aria)+'">' +
    '<span class="ms-progress-chips" aria-hidden="true">'+chips+'</span>' +
  '</span>';
}

function msSoftFlagTitle(ticket){
  const handoff = resolveMsHandoff(ticket);
  const src = handoff && handoff.source === 'key-change'
    ? 'WDW→CONTENT handoff'
    : 'CONTENT created (fallback)';
  const when = handoff && handoff.date ? handoff.date : 'unknown';
  return 'Soft red flag: 3+ calendar days since '+src+' ('+when+'), still with MS, no progress action';
}

function renderContentListHtml(tickets){
  if(!tickets.length){
    return '<div class="content-empty">No open CONTENT tickets you own for delivery right now.</div>';
  }
  const msSoloKeys = msSoloKeySet(STATE.data);
  return '<table class="content-table"><thead><tr>' +
    '<th>Key</th><th>Summary</th><th>Status</th><th>Progress</th><th>Assignee</th><th>Due</th><th>Partner</th>' +
    '</tr></thead><tbody>' +
    tickets.map(t => {
      const tLink = jiraLink(t.key);
      const keyHtml = tLink
        ? '<a class="jira-link" href="'+tLink+'" target="_blank" rel="noopener">'+escapeHtml(t.key)+'</a>'
        : escapeHtml(t.key);
      const soft = isMsCheckinSoft(t, msSoloKeys);
      const softHint = soft
        ? '<span class="ms-checkin-flag" title="'+escapeAttr(msSoftFlagTitle(t))+'" role="img" aria-label="Soft red flag — check in with MS">⚑</span>'
        : '';
      return '<tr'+(soft ? ' class="ms-checkin-row"' : '')+'>' +
        '<td class="primary">'+keyHtml+softHint+'</td>' +
        '<td class="content-summary">'+escapeHtml(t.summary || '')+'</td>' +
        '<td>'+escapeHtml(t.status || '—')+'</td>' +
        '<td class="ms-progress-cell">'+renderContentMotionCell(t)+'</td>' +
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

/** Open (non-Closed) TRANSLATIONS on active + recently closed — same pool as Translations nav enablement. */
function openTranslationsEntries(){
  const entries = [];
  const seen = new Set();
  function consider(t){
    const st = (t.subtasks || []).find(s => s.type === 'TRANSLATIONS');
    if(!st || st.status === 'Closed') return;
    const id = st.key || (t.key + ':TRANSLATIONS');
    if(seen.has(id)) return;
    seen.add(id);
    entries.push({ ticket: t, st });
  }
  ((STATE.data && STATE.data.activeTickets) || []).forEach(consider);
  ((STATE.data && STATE.data.msSoloTickets) || []).forEach(consider);
  recentlyClosedOwnTickets().forEach(consider);
  return entries;
}

function renderTranslations(){
  const wrap = document.getElementById('translationsWrap');
  const entries = [];
  ((STATE.data && STATE.data.activeTickets) || []).forEach(t => {
    const st = (t.subtasks || []).find(s => s.type === 'TRANSLATIONS');
    if(st) entries.push({ ticket: t, st });
  });
  ((STATE.data && STATE.data.msSoloTickets) || []).forEach(t => {
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

/** Enable Copy / Media / Alt Text / Translations nav only when matching open sub-tasks exist. */
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
  const navTr = document.getElementById('navTranslations') ||
    document.querySelector('.nav-item[data-view="translations"]');
  if(navTr){
    const hasTr = openTranslationsEntries().length > 0;
    navTr.classList.toggle('disabled', !hasTr);
    navTr.setAttribute('aria-disabled', hasTr ? 'false' : 'true');
    if(!hasTr && navTr.classList.contains('active')){
      const solo = document.querySelector('.nav-item[data-view="solo"]');
      if(solo) solo.click();
    }
  }
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
    const soloCount = ((data.activeTickets || []).length) + ((data.msSoloTickets || []).length);
    document.getElementById('greetingSub').textContent =
      soloCount
        ? soloCount + ' active ticket' + (soloCount===1?'':'s') + ' on your board' +
          ((data.msSoloTickets || []).length
            ? ' (' + data.msSoloTickets.length + ' Managed Services).'
            : '.')
        : 'Nothing active — you are all caught up.';
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

(function bindAtRiskChrome(){
  const closeBtn = document.getElementById('atRiskModalClose');
  if(closeBtn) closeBtn.addEventListener('click', closeAtRiskModal);
  const modal = document.getElementById('atRiskModal');
  if(modal){
    modal.querySelectorAll('[data-at-risk-modal-dismiss]').forEach(el => {
      el.addEventListener('click', closeAtRiskModal);
    });
  }
})();

loadSavedConfig();
loadAll(false);

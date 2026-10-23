/* ============================================================
   launches.js — Launches tab (epic routing + runbook checklist)
   ============================================================ */

const LAUNCH_CHECK_STATES = ['not_started', 'in_progress', 'verified'];
const LAUNCH_STATE_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  verified: 'Verified'
};

let launchProgressCache = {};
let launchProgressLoaded = false;
let launchExpandedKey = null;
/** @type {Record<string, 'checklist'|'live'>} */
let launchDetailView = {};
/** @type {Record<string, { loading?: boolean, error?: string, data?: object, showNa?: boolean }>} */
let launchLiveState = {};

function isLaunchProgramTicket(t) {
  return !!(t && (t.isLaunchEpic || t.isLaunchMilestone));
}

async function ensureLaunchProgressLoaded() {
  if (launchProgressLoaded) return launchProgressCache;
  try {
    const res = await fetch('/api/launch/progress');
    if (res.ok) launchProgressCache = await res.json();
  } catch (_) {
    launchProgressCache = {};
  }
  launchProgressLoaded = true;
  return launchProgressCache;
}

async function saveLaunchProgress() {
  try {
    await fetch('/api/launch/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(launchProgressCache)
    });
  } catch (_) {
    /* ignore */
  }
}

function launchProgressFor(epicKey, rowId) {
  const epic = launchProgressCache[epicKey] || {};
  const row = epic[rowId] || {};
  return {
    stage: row.stage || 'not_started',
    prod: row.prod || 'not_started'
  };
}

function setLaunchProgress(epicKey, rowId, env, state) {
  if (!launchProgressCache[epicKey]) launchProgressCache[epicKey] = {};
  if (!launchProgressCache[epicKey][rowId]) launchProgressCache[epicKey][rowId] = {};
  launchProgressCache[epicKey][rowId][env] = state;
}

function launchFlagEnabled(config, flagName) {
  if (!flagName) return true;
  const flags = (config && config.launchFlags) || {};
  return flags[flagName] === true;
}

function rowApplies(row, launchType, config) {
  if (!launchFlagEnabled(config, row.requiresLaunchFlag)) return false;
  const overrides = (config && config.rowOverrides && config.rowOverrides[row.id]) || {};
  if (overrides.applies === false) return false;
  if (overrides.applies === true) return true;
  const types = row.appliesTo || [];
  return types.includes(launchType);
}

function sectionApplies(section, config) {
  return launchFlagEnabled(config, section.requiresLaunchFlag);
}

function applicableRows(template, launchType, config) {
  const sections = (template && template.sections) || [];
  const out = [];
  sections.forEach((sec) => {
    if (!sectionApplies(sec, config)) return;
    (sec.rows || []).forEach((row) => {
      if (rowApplies(row, launchType, config)) {
        out.push({ section: sec, row });
      }
    });
  });
  return out;
}

function milestoneLabel(kind) {
  if (kind === 'bookings') return 'Bookings Launch';
  if (kind === 'service') return 'Service Start';
  return 'Milestone';
}

function launchDaysUntil(dueDate) {
  if (!dueDate) return null;
  const d = atMidnight(dueDate);
  const today = todayMid();
  return businessDaysBetween(today, d);
}

function launchDueHint(dueDate) {
  const days = launchDaysUntil(dueDate);
  if (days == null) return '—';
  if (days === 0) return 'Today';
  if (days < 0) return Math.abs(days) + 'd overdue';
  return 'In ' + days + 'd';
}

function renderCheckStateSelect(epicKey, rowId, env, current) {
  const opts = LAUNCH_CHECK_STATES.map(
    (s) =>
      '<option value="' +
      s +
      '"' +
      (s === current ? ' selected' : '') +
      '>' +
      LAUNCH_STATE_LABELS[s] +
      '</option>'
  ).join('');
  return (
    '<select class="launch-check-select" data-launch-progress="' +
    escapeAttr(epicKey) +
    '" data-row="' +
    escapeAttr(rowId) +
    '" data-env="' +
    escapeAttr(env) +
    '">' +
    opts +
    '</select>'
  );
}

function launchDetailViewFor(epicKey) {
  return launchDetailView[epicKey] || 'checklist';
}

function renderLaunchViewTabs(epicKey) {
  const view = launchDetailViewFor(epicKey);
  return (
    '<div class="launch-view-tabs" role="tablist">' +
    '<button type="button" class="launch-view-tab' +
    (view === 'checklist' ? ' is-active' : '') +
    '" role="tab" data-launch-view="checklist" data-launch-key="' +
    escapeAttr(epicKey) +
    '">GCx checklist</button>' +
    '<button type="button" class="launch-view-tab' +
    (view === 'live' ? ' is-active' : '') +
    '" role="tab" data-launch-view="live" data-launch-key="' +
    escapeAttr(epicKey) +
    '">Live runbook</button>' +
    '</div>'
  );
}

function statusClassForRunbook(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('complete') || s.includes('done')) return 'launch-live-status--done';
  if (s.includes('progress')) return 'launch-live-status--active';
  if (s.includes('not applicable') || s === 'n/a') return 'launch-live-status--na';
  return '';
}

function renderLaunchLiveTable(epicKey) {
  const st = launchLiveState[epicKey] || {};
  if (st.loading) {
    return '<div class="launch-live-loading"><div class="spinner"></div><span>Loading from Smartsheet…</span></div>';
  }
  if (st.error) {
    return (
      '<div class="launch-live-error">' +
      '<p>' +
      escapeHtml(st.error) +
      '</p>' +
      '<p class="launch-hint">Add <code>SMARTSHEET_ACCESS_TOKEN</code> to repo-root <code>.env</code> and restart <code>npm start</code>. See <code>docs/SMARTSHEET-LAUNCH.md</code>.</p>' +
      '<button type="button" class="launch-live-refresh" data-launch-live-refresh="' +
      escapeAttr(epicKey) +
      '">Retry</button></div>'
    );
  }
  const data = st.data;
  if (!data || !data.tasks || !data.tasks.length) {
    return (
      '<p class="launch-hint">No tasks returned. Open <strong>Live runbook</strong> after configuring Smartsheet, or use <strong>Open runbook</strong>.</p>' +
      '<button type="button" class="launch-live-refresh" data-launch-live-refresh="' +
      escapeAttr(epicKey) +
      '">Load from Smartsheet</button>'
    );
  }
  const showNa = !!st.showNa;
  let rows = data.tasks;
  if (!showNa) rows = rows.filter((t) => !t.notApplicable);

  let body = '';
  rows.forEach((t) => {
    if (t.isSectionHeader) {
      body +=
        '<tr class="launch-live-row launch-live-row--section"><td colspan="6">' +
        escapeHtml(t.taskName || t.section || 'Section') +
        '</td></tr>';
      return;
    }
    body +=
      '<tr class="launch-live-row' +
      (t.notApplicable ? ' launch-live-row--na' : '') +
      '">' +
      '<td class="launch-live-num">' +
      escapeHtml(String(t.rowNumber || '')) +
      '</td>' +
      '<td class="launch-live-team">' +
      escapeHtml(t.team || '') +
      '</td>' +
      '<td class="launch-live-task">' +
      escapeHtml(t.taskName || '') +
      '</td>' +
      '<td class="launch-live-status ' +
      statusClassForRunbook(t.status) +
      '">' +
      escapeHtml(t.status || '') +
      '</td>' +
      '<td class="launch-live-dates">' +
      escapeHtml([t.startDate, t.dueDate].filter(Boolean).join(' → ') || '—') +
      '</td>' +
      '<td class="launch-live-owner">' +
      escapeHtml(t.owner || '') +
      '</td></tr>';
  });

  const meta =
    '<div class="launch-live-meta">' +
    '<span>' +
    escapeHtml(data.sheetName || 'Runbook') +
    ' · ' +
    rows.length +
    ' row' +
    (rows.length === 1 ? '' : 's') +
    (data.hiddenNotApplicable && !showNa
      ? ' (' + data.hiddenNotApplicable + ' N/A hidden)'
      : '') +
    '</span>' +
    (data.fetchedAt
      ? '<span class="launch-live-fetched">Updated ' + escapeHtml(formatLaunchFetchedAt(data.fetchedAt)) + '</span>'
      : '') +
    '<label class="launch-live-na-toggle"><input type="checkbox" data-launch-live-na="' +
    escapeAttr(epicKey) +
    '"' +
    (showNa ? ' checked' : '') +
    '> Show Not Applicable</label>' +
    '<button type="button" class="launch-live-refresh" data-launch-live-refresh="' +
    escapeAttr(epicKey) +
    '">Refresh</button>' +
    '</div>';

  return (
    meta +
    '<div class="launch-live-scroll">' +
    '<table class="launch-live-table"><thead><tr>' +
    '<th>#</th><th>Team</th><th>Task</th><th>Status</th><th>Dates</th><th>Owner</th>' +
    '</tr></thead><tbody>' +
    body +
    '</tbody></table></div>'
  );
}

function formatLaunchFetchedAt(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return iso;
  }
}

async function loadLiveRunbook(epicKey, refresh) {
  if (!epicKey) return;
  const prev = launchLiveState[epicKey] || {};
  launchLiveState[epicKey] = Object.assign({}, prev, { loading: true, error: null });
  renderLaunchList();
  const showNa = !!prev.showNa;
  const qs =
    'epic=' +
    encodeURIComponent(epicKey) +
    (showNa ? '&includeNotApplicable=1' : '') +
    (refresh ? '&refresh=1' : '');
  try {
    const res = await fetch('/api/launch/runbook-live?' + qs);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      launchLiveState[epicKey] = Object.assign({}, prev, {
        loading: false,
        error: (data && data.error) || 'Could not load runbook (HTTP ' + res.status + ').'
      });
    } else {
      launchLiveState[epicKey] = Object.assign({}, prev, { loading: false, error: null, data });
    }
  } catch (err) {
    launchLiveState[epicKey] = Object.assign({}, prev, {
      loading: false,
      error: err && err.message ? err.message : String(err)
    });
  }
  renderLaunchList();
}

function renderLaunchChecklist(epic, template) {
  const config = epic.config || {};
  const rows = applicableRows(template, epic.launchType || 'standardRestaurant', config);
  if (!rows.length) {
    return '<p class="launch-hint">No checklist rows for this launch type.</p>';
  }
  let html = '<div class="launch-checklist">';
  let lastSec = '';
  rows.forEach(({ section, row }) => {
    if (section.title !== lastSec) {
      if (lastSec) html += '</div>';
      html +=
        '<div class="launch-check-section"><div class="launch-check-section-title">' +
        escapeHtml(section.title) +
        '</div>';
      lastSec = section.title;
    }
    const prog = launchProgressFor(epic.key, row.id);
    const byRow = (config.plannedDatesByRow && config.plannedDatesByRow[row.id]) || null;
    const planned =
      byRow ||
      (config.plannedDates &&
        ((row.id === 'initial-details' && config.plannedDates.initialDetails) ||
          (row.id === 'prod-bookings' && config.plannedDates.bookingsLaunch) ||
          (row.id === 'prod-service' && config.plannedDates.serviceStart)));
    html +=
      '<div class="launch-check-row" data-row-id="' +
      escapeAttr(row.id) +
      '">' +
      '<div class="launch-check-row-head">' +
      '<span class="launch-check-label">' +
      escapeHtml(row.label) +
      (row.optional ? ' <span class="launch-optional">(optional)</span>' : '') +
      '</span>' +
      (planned ? '<span class="launch-planned-date">Plan: ' + escapeHtml(planned) + '</span>' : '') +
      '</div>' +
      '<div class="launch-check-cols">' +
      '<label class="launch-check-col"><span>Stage</span>' +
      renderCheckStateSelect(epic.key, row.id, 'stage', prog.stage) +
      '</label>' +
      '<label class="launch-check-col"><span>Prod</span>' +
      renderCheckStateSelect(epic.key, row.id, 'prod', prog.prod) +
      '</label>' +
      '</div>';
    if (row.help) {
      html +=
        '<details class="launch-check-help"><summary>Why / how</summary><p>' +
        escapeHtml(row.help) +
        '</p></details>';
    }
    html += '</div>';
  });
  if (lastSec) html += '</div>';
  html += '</div>';
  return html;
}

function renderLaunchCard(epic, template) {
  const config = epic.config || {};
  const tLink = jiraLink(epic.key);
  const summaryHtml = tLink
    ? '<a class="jira-link" href="' + tLink + '" target="_blank" rel="noopener">' + escapeHtml(epic.summary || epic.key) + '</a>'
    : escapeHtml(epic.summary || epic.key);
  const expanded = launchExpandedKey === epic.key;
  let actions = '';
  if (config.runbookUrl) {
    actions +=
      '<a class="launch-action-btn" href="' +
      escapeHtml(config.runbookUrl) +
      '" target="_blank" rel="noopener">Open runbook</a>';
  }
  if (config.bellSheetUrl) {
    actions +=
      '<a class="launch-action-btn launch-action-btn--secondary" href="' +
      escapeHtml(config.bellSheetUrl) +
      '" target="_blank" rel="noopener">Bell sheet</a>';
  }
  if (config.facilityProdUrl) {
    actions +=
      '<a class="launch-action-btn launch-action-btn--secondary" href="' +
      escapeHtml(config.facilityProdUrl) +
      '" target="_blank" rel="noopener">Prod page</a>';
  }

  let refs = '';
  if (config.facilityId) {
    refs += '<span class="launch-ref">Facility ID: <code>' + escapeHtml(config.facilityId) + '</code></span>';
  }
  const mpc = config.mealPeriodChange;
  if (mpc && mpc.summary) {
    refs +=
      '<span class="launch-ref launch-ref--note">' + escapeHtml(mpc.summary) + '</span>';
  }
  const mp = config.mealPeriodIds || {};
  if (mp.breakfast || mp.lunch) {
    refs +=
      '<span class="launch-ref">Meal period IDs: breakfast ' +
      escapeHtml(mp.breakfast || '—') +
      ' · lunch ' +
      escapeHtml(mp.lunch || '—') +
      '</span>';
  } else if (config.bellSheetForm && config.bellSheetForm.rows) {
    const r = config.bellSheetForm.rows;
    refs +=
      '<span class="launch-ref">Bell sheet (' +
      escapeHtml(config.bellSheetForm.name || 'Build Sheet') +
      '): breakfast row ' +
      escapeHtml(String(r.breakfast || '—')) +
      ' · lunch row ' +
      escapeHtml(String(r.lunch || '—')) +
      '</span>';
  }

  let milestonesHtml = '';
  (epic.milestones || []).forEach((m) => {
    const mLink = jiraLink(m.key);
    const label = milestoneLabel(m.milestoneKind);
    milestonesHtml +=
      '<div class="launch-milestone">' +
      '<span class="launch-milestone-kind">' +
      escapeHtml(label) +
      '</span> ' +
      (mLink
        ? '<a class="jira-link" href="' + mLink + '" target="_blank" rel="noopener">' + escapeHtml(m.key) + '</a>'
        : escapeHtml(m.key)) +
      ' · ' +
      escapeHtml(m.status || '') +
      ' · Due ' +
      escapeHtml(launchDueHint(m.dueDate)) +
      '</div>';
  });

  const bookingsM = (epic.milestones || []).find((m) => m.milestoneKind === 'bookings');
  const badge = bookingsM && bookingsM.dueDate
    ? '<span class="launch-urgency">Bookings ' + escapeHtml(launchDueHint(bookingsM.dueDate)) + '</span>'
    : '';

  return (
    '<div class="ticket-card launch-card' +
    (expanded ? ' expanded' : '') +
    '" data-launch-key="' +
    escapeAttr(epic.key) +
    '">' +
    '<div class="ticket-row launch-row" data-launch-toggle="' +
    escapeAttr(epic.key) +
    '">' +
    '<div class="score-stack">' +
    '<div class="score-badge launch-badge" title="Launch epic">Launch</div>' +
    '</div>' +
    '<div class="ticket-main">' +
    '<div class="ticket-summary">' +
    summaryHtml +
    '</div>' +
    '<div class="ticket-tag">' +
    escapeHtml(config.title || epic.key) +
    badge +
    '</div>' +
    (refs ? '<div class="launch-refs">' + refs + '</div>' : '') +
    '</div>' +
    '<div class="launch-row-actions">' +
    actions +
    '</div>' +
    '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>' +
    '</div>' +
    (expanded
      ? '<div class="launch-detail">' +
        (milestonesHtml ? '<div class="launch-milestones">' + milestonesHtml + '</div>' : '') +
        renderLaunchViewTabs(epic.key) +
        '<div class="launch-view-panel' +
        (launchDetailViewFor(epic.key) === 'checklist' ? '' : ' hidden') +
        '" data-launch-panel="checklist">' +
        renderLaunchChecklist(epic, template) +
        '</div>' +
        '<div class="launch-view-panel' +
        (launchDetailViewFor(epic.key) === 'live' ? '' : ' hidden') +
        '" data-launch-panel="live">' +
        renderLaunchLiveTable(epic.key) +
        '</div>' +
        '</div>'
      : '') +
    '</div>'
  );
}

function bindLaunchListEvents(root) {
  if (!root || root.dataset.launchBound === '1') return;
  root.dataset.launchBound = '1';
  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-launch-view]');
    if (tab && root.contains(tab)) {
      const key = tab.getAttribute('data-launch-key');
      const view = tab.getAttribute('data-launch-view');
      if (key && (view === 'checklist' || view === 'live')) {
        launchDetailView[key] = view;
        renderLaunchList();
        if (view === 'live' && key && !(launchLiveState[key] && launchLiveState[key].data) && !launchLiveState[key]?.loading) {
          loadLiveRunbook(key, false);
        }
      }
      return;
    }
    const refreshBtn = e.target.closest('[data-launch-live-refresh]');
    if (refreshBtn && root.contains(refreshBtn)) {
      const key = refreshBtn.getAttribute('data-launch-live-refresh');
      if (key) loadLiveRunbook(key, true);
      return;
    }
    const toggle = e.target.closest('[data-launch-toggle]');
    if (toggle && root.contains(toggle)) {
      const key = toggle.getAttribute('data-launch-toggle');
      const opening = launchExpandedKey !== key;
      launchExpandedKey = launchExpandedKey === key ? null : key;
      renderLaunchList();
      if (opening && key && launchDetailViewFor(key) === 'live') {
        loadLiveRunbook(key, false);
      }
      return;
    }
  });
  root.addEventListener('change', (e) => {
    const na = e.target.closest('[data-launch-live-na]');
    if (na && root.contains(na)) {
      const key = na.getAttribute('data-launch-live-na');
      if (!key) return;
      launchLiveState[key] = Object.assign({}, launchLiveState[key] || {}, { showNa: na.checked });
      loadLiveRunbook(key, false);
    }
  });
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('.launch-check-select');
    if (!sel || !root.contains(sel)) return;
    const epicKey = sel.getAttribute('data-launch-progress');
    const rowId = sel.getAttribute('data-row');
    const env = sel.getAttribute('data-env');
    const val = sel.value;
    if (!epicKey || !rowId || !env) return;
    setLaunchProgress(epicKey, rowId, env, val);
    saveLaunchProgress();
  });
}

async function renderLaunchList() {
  const container = document.getElementById('launchList');
  if (!container) return;
  const data = STATE.data;
  if (!data) {
    container.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
    return;
  }
  await ensureLaunchProgressLoaded();
  const epics = data.launchEpics || [];
  const template = data.launchTemplate || { sections: [] };
  if (!epics.length) {
    container.innerHTML =
      '<div class="empty-state"><b>No launch epics on your board</b>' +
      '<p class="launch-hint">Launch epics are WDW <strong>Epic</strong> issues whose summary contains “Launch”, assigned or reported to you. Runbook links live in <code>data/launch-runbooks.json</code>.</p></div>';
    return;
  }
  container.innerHTML = epics.map((e) => renderLaunchCard(e, template)).join('');
  bindLaunchListEvents(container);
  const expanded = launchExpandedKey;
  if (
    expanded &&
    launchDetailViewFor(expanded) === 'live' &&
    !(launchLiveState[expanded] && (launchLiveState[expanded].data || launchLiveState[expanded].loading || launchLiveState[expanded].error))
  ) {
    loadLiveRunbook(expanded, false);
  }
}

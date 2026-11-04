/* ============================================================
   launches.js — Launches tab (epic routing + runbook checklist)
   ============================================================ */

const LAUNCH_CHECK_STATES = ['not_started', 'in_progress', 'verified', 'na'];
const LAUNCH_STATE_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  verified: 'Verified',
  na: 'N/A'
};

const LAUNCH_PHASE_CHIP = {
  preparation: 'launch-phase-chip--prep',
  validation: 'launch-phase-chip--val',
  launchDay: 'launch-phase-chip--day'
};

const LAUNCH_SECTION_CHIP = {
  'dscribe-pro-prep': 'launch-sec-chip--authoring',
  'prep-stakeholders': 'launch-sec-chip--prep',
  'prep-look-only': 'launch-sec-chip--prep',
  ids: 'launch-sec-chip--prep',
  'prep-bell-content': 'launch-sec-chip--prep',
  copy: 'launch-sec-chip--prep',
  'validation-backend': 'launch-sec-chip--val',
  'validation-testing': 'launch-sec-chip--val',
  stage: 'launch-sec-chip--val',
  'wait-room': 'launch-sec-chip--val',
  dfm: 'launch-sec-chip--day',
  'launch-day-run': 'launch-sec-chip--day',
  prod: 'launch-sec-chip--day'
};

let launchProgressCache = {};
let launchProgressLoaded = false;
let launchExpandedKey = null;
/** @type {Record<string, 'checklist'|'embed'|'live'>} */
let launchDetailView = {};
/** @type {Record<string, boolean>} */
let launchShowNaSections = {};
const LAUNCH_META_KEY = '__meta';
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
  if (!rowId || rowId === LAUNCH_META_KEY) {
    return { stage: 'not_started', prod: 'not_started' };
  }
  const epic = launchProgressCache[epicKey] || {};
  const row = epic[rowId] || {};
  return {
    stage: row.stage || 'not_started',
    prod: row.prod || 'not_started'
  };
}

function setLaunchProgress(epicKey, rowId, env, state) {
  if (!rowId || rowId === LAUNCH_META_KEY) return;
  if (!launchProgressCache[epicKey]) launchProgressCache[epicKey] = {};
  if (!launchProgressCache[epicKey][rowId]) launchProgressCache[epicKey][rowId] = {};
  launchProgressCache[epicKey][rowId][env] = state;
}

function getLaunchMeta(epicKey) {
  if (!launchProgressCache[epicKey]) launchProgressCache[epicKey] = {};
  const epic = launchProgressCache[epicKey];
  if (!epic[LAUNCH_META_KEY]) {
    epic[LAUNCH_META_KEY] = { phases: {}, sections: {} };
  }
  return epic[LAUNCH_META_KEY];
}

function sectionsById(template) {
  const map = {};
  ((template && template.sections) || []).forEach((sec) => {
    if (sec && sec.id) map[sec.id] = sec;
  });
  return map;
}

function sectionApplicableRows(section, launchType, config) {
  if (!section || !sectionApplies(section, config)) return [];
  return (section.rows || []).filter((row) => rowApplies(row, launchType, config));
}

function rowTrackEnv(row) {
  const t = row && row.trackEnv ? row.trackEnv : 'both';
  if (t === 'done' || t === 'stage' || t === 'prod') return t;
  return 'both';
}

function envStateDone(state) {
  return state === 'verified' || state === 'na';
}

function rowIsVerified(prog, row) {
  const track = rowTrackEnv(row);
  if (track === 'done' || track === 'stage') return envStateDone(prog.stage);
  if (track === 'prod') return envStateDone(prog.prod);
  return envStateDone(prog.stage) && envStateDone(prog.prod);
}

function rowVisualStateClass(prog, row) {
  const track = rowTrackEnv(row);
  const pick = (env) => prog[env] || 'not_started';
  const states =
    track === 'prod'
      ? [pick('prod')]
      : track === 'stage' || track === 'done'
        ? [pick('stage')]
        : [pick('stage'), pick('prod')];
  if (states.every((s) => s === 'na')) return 'launch-check-row--na';
  if (states.every((s) => envStateDone(s))) return 'launch-check-row--done';
  if (states.some((s) => s === 'in_progress')) return 'launch-check-row--active';
  if (states.some((s) => envStateDone(s))) return 'launch-check-row--partial';
  return 'launch-check-row--todo';
}

function sectionChipClass(sectionId) {
  return LAUNCH_SECTION_CHIP[sectionId] || 'launch-sec-chip--default';
}

function phaseChipClass(phaseId) {
  return LAUNCH_PHASE_CHIP[phaseId] || 'launch-phase-chip--default';
}

function phaseProgressCounts(epicKey, phase, template, launchType, config) {
  const secMap = sectionsById(template);
  let total = 0;
  let done = 0;
  (phase.sectionIds || []).forEach((sid) => {
    const sec = secMap[sid];
    if (!sec) return;
    const rows = sectionApplicableRows(sec, launchType, config);
    rows.forEach((row) => {
      total++;
      if (rowIsVerified(launchProgressFor(epicKey, row.id), row)) done++;
    });
  });
  return { total, done };
}

function sectionCollapsed(epicKey, sectionId, meta) {
  const sec = meta.sections && meta.sections[sectionId];
  return !!(sec && sec.collapsed);
}

function phaseMetaState(epicKey, phaseId, meta) {
  const p = meta.phases && meta.phases[phaseId];
  return {
    complete: !!(p && p.complete),
    collapsed: !!(p && p.collapsed)
  };
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

function mergeLaunchGuide(guide, helpFallback) {
  const g = guide && typeof guide === 'object' ? Object.assign({}, guide) : {};
  if (!g.objective && helpFallback) g.objective = String(helpFallback);
  if (!g.objective && !(g.steps && g.steps.length) && !g.owner && !g.contact && !g.turnaround) {
    return null;
  }
  return g;
}

function renderLaunchGuideHtml(guide, title, helpFallback) {
  const g = mergeLaunchGuide(guide, helpFallback);
  if (!g) return '';
  let inner = '';
  if (g.objective) {
    inner += '<p class="launch-guide-lead">' + escapeHtml(g.objective) + '</p>';
  }
  if (g.owner) {
    inner +=
      '<p class="launch-guide-line"><span class="launch-guide-k">Who owns it</span> ' +
      escapeHtml(g.owner) +
      '</p>';
  }
  if (g.contact) {
    inner +=
      '<p class="launch-guide-line"><span class="launch-guide-k">Who to ping</span> ' +
      escapeHtml(g.contact) +
      '</p>';
  }
  if (g.turnaround) {
    inner +=
      '<p class="launch-guide-line"><span class="launch-guide-k">Typical timing</span> ' +
      escapeHtml(g.turnaround) +
      '</p>';
  }
  if (g.steps && g.steps.length) {
    inner += '<ol class="launch-guide-steps">';
    g.steps.forEach((step) => {
      inner += '<li>' + escapeHtml(step) + '</li>';
    });
    inner += '</ol>';
  }
  const label = title ? 'About: ' + title : 'More info';
  return (
    '<details class="launch-guide">' +
    '<summary class="launch-guide-btn" title="' +
    escapeAttr(label) +
    '" aria-label="' +
    escapeAttr(label) +
    '"><span class="launch-guide-icon" aria-hidden="true">i</span></summary>' +
    '<div class="launch-guide-panel">' +
    inner +
    '</div></details>'
  );
}

function renderCheckStateChipGroup(epicKey, rowId, env, current) {
  const chips = LAUNCH_CHECK_STATES.map((s) => {
    return (
      '<button type="button" class="launch-status-chip launch-status-chip--' +
      s +
      (s === current ? ' is-active' : '') +
      '" data-launch-progress="' +
      escapeAttr(epicKey) +
      '" data-row="' +
      escapeAttr(rowId) +
      '" data-env="' +
      escapeAttr(env) +
      '" data-value="' +
      s +
      '" aria-pressed="' +
      (s === current ? 'true' : 'false') +
      '">' +
      escapeHtml(LAUNCH_STATE_LABELS[s]) +
      '</button>'
    );
  }).join('');
  return '<div class="launch-status-chips" role="group">' + chips + '</div>';
}

function renderPhaseCompleteSwitch(epicKey, phaseId, checked) {
  return (
    '<label class="launch-switch" title="Mark phase complete">' +
    '<input type="checkbox" class="launch-switch-input" data-launch-phase-complete="' +
    escapeAttr(phaseId) +
    '" data-launch-key="' +
    escapeAttr(epicKey) +
    '"' +
    (checked ? ' checked' : '') +
    '>' +
    '<span class="launch-switch-track" aria-hidden="true"><span class="launch-switch-thumb"></span></span>' +
    '<span class="launch-switch-label">Phase complete</span></label>'
  );
}

function parseRunbookDate(str) {
  if (!str) return null;
  const raw = String(str).trim();
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return atMidnight(iso);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const d = new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    if (!Number.isNaN(d.getTime())) return atMidnight(d);
  }
  return null;
}

function isRunbookTaskComplete(status) {
  const s = String(status || '').toLowerCase();
  return s.includes('complete') || s.includes('done');
}

function computeLaunchScheduleStatus(epicKey) {
  const st = launchLiveState[epicKey] || {};
  if (st.loading && !st.data) {
    return { level: 'unknown', label: 'Checking runbook dates…' };
  }
  if (!st.data || !st.data.tasks || !st.data.tasks.length) {
    if (st.error) return { level: 'unknown', label: 'Runbook dates unavailable' };
    return { level: 'unknown', label: '' };
  }
  const today = todayMid();
  let overdue = 0;
  let dueSoon = 0;
  const SOON_BD = 3;
  st.data.tasks.forEach((t) => {
    if (t.isSectionHeader) return;
    if (t.notApplicable || isRunbookTaskComplete(t.status)) return;
    const s = String(t.status || '').toLowerCase();
    if (s.includes('not applicable') || s === 'n/a') return;
    const due = parseRunbookDate(t.dueDate) || parseRunbookDate(t.startDate);
    if (!due) return;
    const bd = businessDaysBetween(today, due);
    if (bd < 0) overdue++;
    else if (bd <= SOON_BD) dueSoon++;
  });
  if (overdue) {
    return {
      level: 'red',
      label: overdue === 1 ? '1 overdue runbook task' : overdue + ' overdue runbook tasks'
    };
  }
  if (dueSoon) {
    return {
      level: 'orange',
      label: dueSoon === 1 ? 'Runbook task due soon' : dueSoon + ' runbook tasks due soon'
    };
  }
  return { level: 'green', label: 'Runbook on track' };
}

function renderLaunchSchedulePill(epicKey) {
  const st = computeLaunchScheduleStatus(epicKey);
  if (!st.label) return '';
  return (
    '<span class="launch-schedule-pill launch-schedule-pill--' +
    st.level +
    '" title="From live Smartsheet due dates">' +
    escapeHtml(st.label) +
    '</span>'
  );
}

function launchDetailViewFor(epicKey) {
  return launchDetailView[epicKey] || 'checklist';
}

function renderLaunchViewTabs(epicKey, config) {
  const view = launchDetailViewFor(epicKey);
  const hasRunbook = !!(config && config.runbookUrl);
  let html =
    '<div class="launch-view-tabs" role="tablist">' +
    '<button type="button" class="launch-view-tab' +
    (view === 'checklist' ? ' is-active' : '') +
    '" role="tab" data-launch-view="checklist" data-launch-key="' +
    escapeAttr(epicKey) +
    '">GCx checklist</button>';
  if (hasRunbook) {
    html +=
      '<button type="button" class="launch-view-tab' +
      (view === 'embed' ? ' is-active' : '') +
      '" role="tab" data-launch-view="embed" data-launch-key="' +
      escapeAttr(epicKey) +
      '">Smartsheet</button>';
  }
  html +=
    '<button type="button" class="launch-view-tab' +
    (view === 'live' ? ' is-active' : '') +
    '" role="tab" data-launch-view="live" data-launch-key="' +
    escapeAttr(epicKey) +
    '">Live runbook</button></div>';
  return html;
}

function renderLaunchEmbedPanel(config) {
  const url = config && config.runbookUrl;
  if (!url) {
    return '<p class="launch-hint">Add <code>runbookUrl</code> in launch runbook config.</p>';
  }
  return (
    '<p class="launch-hint">Uses your Smartsheet login in this browser. If the frame stays blank, use <strong>Open runbook</strong>.</p>' +
    '<div class="launch-embed-wrap">' +
    '<iframe class="launch-embed-frame" title="Smartsheet runbook" src="' +
    escapeHtml(url) +
    '"></iframe></div>'
  );
}

function renderLaunchTicketsBlock(epic) {
  const rows = [];
  const epicLink = jiraLink(epic.key);
  rows.push({
    kind: 'Epic',
    key: epic.key,
    summary: epic.summary || '',
    status: epic.status || '',
    due: launchDueHint(epic.dueDate)
  });
  (epic.milestones || []).forEach((m) => {
    rows.push({
      kind: milestoneLabel(m.milestoneKind),
      key: m.key,
      summary: m.summary || '',
      status: m.status || '',
      due: launchDueHint(m.dueDate)
    });
  });
  if (!rows.length) return '';
  const body = rows
    .map((r) => {
      const keyHtml = jiraLink(r.key)
        ? '<a class="jira-link" href="' + jiraLink(r.key) + '" target="_blank" rel="noopener">' + escapeHtml(r.key) + '</a>'
        : escapeHtml(r.key);
      return (
        '<tr><td class="launch-tickets-kind">' +
        escapeHtml(r.kind) +
        '</td><td class="primary">' +
        keyHtml +
        '</td><td>' +
        escapeHtml(r.summary) +
        '</td><td>' +
        escapeHtml(r.status) +
        '</td><td>' +
        escapeHtml(r.due) +
        '</td></tr>'
      );
    })
    .join('');
  return (
    '<div class="launch-tickets-block">' +
    '<div class="launch-tickets-head">Launch tickets</div>' +
    '<p class="launch-tickets-hint">Keep the epic and milestone subtasks aligned with the runbook.</p>' +
    '<table class="data-table launch-tickets-table"><thead><tr>' +
    '<th>Type</th><th>Key</th><th>Summary</th><th>Status</th><th>Due</th>' +
    '</tr></thead><tbody>' +
    body +
    '</tbody></table></div>'
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

async function loadLiveRunbook(epicKey, refresh, options) {
  if (!epicKey) return;
  const silent = !!(options && options.silent);
  const prev = launchLiveState[epicKey] || {};
  launchLiveState[epicKey] = Object.assign({}, prev, { loading: true, error: null });
  if (!silent) renderLaunchList();
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

function renderCheckRowCols(epicKey, row, prog) {
  const track = rowTrackEnv(row);
  if (track === 'done' || track === 'stage') {
    return (
      '<div class="launch-check-cols">' +
      '<span class="launch-check-col-label">' +
      (track === 'done' ? 'Status' : 'Stage') +
      '</span>' +
      renderCheckStateChipGroup(epicKey, row.id, 'stage', prog.stage) +
      '</div>'
    );
  }
  if (track === 'prod') {
    return (
      '<div class="launch-check-cols">' +
      '<span class="launch-check-col-label">Prod</span>' +
      renderCheckStateChipGroup(epicKey, row.id, 'prod', prog.prod) +
      '</div>'
    );
  }
  return (
    '<div class="launch-check-cols launch-check-cols--dual">' +
    '<div class="launch-check-col-block">' +
    '<span class="launch-check-col-label">Stage</span>' +
    renderCheckStateChipGroup(epicKey, row.id, 'stage', prog.stage) +
    '</div>' +
    '<div class="launch-check-col-block">' +
    '<span class="launch-check-col-label">Prod</span>' +
    renderCheckStateChipGroup(epicKey, row.id, 'prod', prog.prod) +
    '</div></div>'
  );
}

function renderLaunchCheckRow(epic, row, config) {
  const prog = launchProgressFor(epic.key, row.id);
  const byRow = (config.plannedDatesByRow && config.plannedDatesByRow[row.id]) || null;
  const planned =
    byRow ||
    (config.plannedDates &&
      ((row.id === 'initial-details' && config.plannedDates.initialDetails) ||
        (row.id === 'prod-bookings' && config.plannedDates.bookingsLaunch) ||
        (row.id === 'prod-service' && config.plannedDates.serviceStart)));
  const rowClass = rowVisualStateClass(prog, row);
  return (
    '<div class="launch-check-row ' +
    rowClass +
    '" data-row-id="' +
    escapeAttr(row.id) +
    '">' +
    '<div class="launch-check-row-head">' +
    '<span class="launch-check-label-wrap">' +
    '<span class="launch-check-label">' +
    escapeHtml(row.label) +
    (row.optional ? ' <span class="launch-optional">(optional)</span>' : '') +
    '</span>' +
    renderLaunchGuideHtml(row.guide, row.label, row.help) +
    '</span>' +
    (planned ? '<span class="launch-planned-date">Plan: ' + escapeHtml(planned) + '</span>' : '') +
    '</div>' +
    renderCheckRowCols(epic.key, row, prog) +
    '</div>'
  );
}

function renderLaunchCheckSection(epic, section, rows, config, meta, showNa, phaseId) {
  if (!rows.length && !showNa) return '';
  const collapsed = sectionCollapsed(epic.key, section.id, meta);
  const chip = sectionChipClass(section.id);
  let html =
    '<div class="launch-check-section' +
    (collapsed ? ' launch-check-section--collapsed' : '') +
    (rows.length ? '' : ' launch-check-section--na') +
    '">';
  html +=
    '<div class="launch-check-section-head">' +
    '<button type="button" class="launch-section-collapse" data-launch-section-toggle="' +
    escapeAttr(section.id) +
    '" data-launch-key="' +
    escapeAttr(epic.key) +
    '" aria-expanded="' +
    (!collapsed ? 'true' : 'false') +
    '">' +
    '<span class="launch-section-chevron" aria-hidden="true"></span>' +
    '<span class="launch-sec-chip ' +
    chip +
    '">' +
    escapeHtml(section.title) +
    '</span></button>' +
    renderLaunchGuideHtml(section.guide, section.title, null) +
    '</div>';
  if (!rows.length) {
    html += '<p class="launch-section-na">Not applicable for this launch.</p>';
  } else if (!collapsed) {
    if (section.guide && section.guide.objective) {
      html += '<p class="launch-section-lead">' + escapeHtml(section.guide.objective) + '</p>';
    }
    rows.forEach((row) => {
      html += renderLaunchCheckRow(epic, row, config);
    });
  }
  html += '</div>';
  return html;
}

function renderLaunchChecklistFlat(epic, template, config, launchType) {
  const rows = applicableRows(template, launchType, config);
  if (!rows.length) {
    return '<p class="launch-hint">No checklist rows for this launch type.</p>';
  }
  let html = '<div class="launch-checklist">';
  let lastSec = '';
  rows.forEach(({ section, row }) => {
    if (section.title !== lastSec) {
      if (lastSec) html += '</div>';
      html += '<div class="launch-check-section">';
      html +=
        '<div class="launch-check-section-head">' +
        '<div class="launch-check-section-title">' +
        escapeHtml(section.title) +
        '</div>' +
        renderLaunchGuideHtml(section.guide, section.title, null) +
        '</div>';
      if (section.guide && section.guide.objective) {
        html += '<p class="launch-section-lead">' + escapeHtml(section.guide.objective) + '</p>';
      }
      lastSec = section.title;
    }
    html += renderLaunchCheckRow(epic, row, config);
  });
  if (lastSec) html += '</div>';
  html += '</div>';
  return html;
}

function renderLaunchChecklist(epic, template) {
  const config = epic.config || {};
  const launchType = epic.launchType || 'standardRestaurant';
  const phases = (template && template.phases) || [];
  if (!phases.length) {
    return renderLaunchChecklistFlat(epic, template, config, launchType);
  }
  const meta = getLaunchMeta(epic.key);
  const showNa = !!launchShowNaSections[epic.key];
  const secMap = sectionsById(template);
  let html =
    '<label class="launch-show-na"><input type="checkbox" data-launch-show-na="' +
    escapeAttr(epic.key) +
    '"' +
    (showNa ? ' checked' : '') +
    '> Show sections not applicable to this launch</label>';
  const dashboardPhases = phases.filter((p) => p.id !== 'today');
  html += '<div class="launch-phases">';
  dashboardPhases.forEach((phase) => {
    const counts = phaseProgressCounts(epic.key, phase, template, launchType, config);
    const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
    const pstate = phaseMetaState(epic.key, phase.id, meta);
    const manualComplete = pstate.complete;
    const autoComplete = counts.total > 0 && counts.done === counts.total;
    const completeClass =
      manualComplete || autoComplete ? ' launch-phase--complete' : '';
    const collapsed = pstate.collapsed && !manualComplete;
    const applicableSections = [];
    const naSections = [];
    (phase.sectionIds || []).forEach((sid) => {
      const sec = secMap[sid];
      if (!sec) return;
      const rows = sectionApplicableRows(sec, launchType, config);
      if (rows.length) applicableSections.push({ sec, rows });
      else if (showNa || sec.requiresLaunchFlag) naSections.push(sec);
    });
    if (!applicableSections.length && !naSections.length) return;
    html +=
      '<div class="launch-phase' +
      completeClass +
      (collapsed ? ' launch-phase--collapsed' : '') +
      '" data-phase-id="' +
      escapeAttr(phase.id) +
      '">';
    html +=
      '<div class="launch-phase-head">' +
      '<button type="button" class="launch-phase-collapse" data-launch-phase-toggle="' +
      escapeAttr(phase.id) +
      '" data-launch-key="' +
      escapeAttr(epic.key) +
      '" aria-expanded="' +
      (!collapsed ? 'true' : 'false') +
      '">' +
      '<span class="launch-phase-chevron" aria-hidden="true"></span>' +
      '<span class="launch-phase-chip ' +
      phaseChipClass(phase.id) +
      '">' +
      escapeHtml(phase.title) +
      '</span>' +
      (counts.total
        ? '<span class="launch-phase-progress">' +
          counts.done +
          '/' +
          counts.total +
          '</span>'
        : '') +
      '</button>' +
      renderLaunchGuideHtml(phase.guide, phase.title, null) +
      renderPhaseCompleteSwitch(epic.key, phase.id, manualComplete) +
      '</div>';
    if (counts.total) {
      html +=
        '<div class="launch-phase-progress-bar" aria-hidden="true">' +
        '<div class="launch-phase-progress-fill" style="width:' +
        pct +
        '%"></div></div>';
    }
    if (!collapsed) {
      if (phase.guide && phase.guide.objective) {
        html += '<p class="launch-phase-lead">' + escapeHtml(phase.guide.objective) + '</p>';
      }
      html += '<div class="launch-checklist">';
      applicableSections.forEach(({ sec, rows }) => {
        html += renderLaunchCheckSection(epic, sec, rows, config, meta, showNa, phase.id);
      });
      naSections.forEach((sec) => {
        html += renderLaunchCheckSection(epic, sec, [], config, meta, true, phase.id);
      });
      html += '</div>';
    }
    html += '</div>';
  });
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

  const bookingsM = (epic.milestones || []).find((m) => m.milestoneKind === 'bookings');
  const detailView = launchDetailViewFor(epic.key);
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
    '<div class="launch-card-top">' +
    renderLaunchSchedulePill(epic.key) +
    '</div>' +
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
        renderLaunchTicketsBlock(epic) +
        renderLaunchViewTabs(epic.key, config) +
        '<div class="launch-view-panel' +
        (detailView === 'checklist' ? '' : ' hidden') +
        '" data-launch-panel="checklist">' +
        renderLaunchChecklist(epic, template) +
        '</div>' +
        '<div class="launch-view-panel' +
        (detailView === 'embed' ? '' : ' hidden') +
        '" data-launch-panel="embed">' +
        renderLaunchEmbedPanel(config) +
        '</div>' +
        '<div class="launch-view-panel' +
        (detailView === 'live' ? '' : ' hidden') +
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
      if (key && (view === 'checklist' || view === 'embed' || view === 'live')) {
        launchDetailView[key] = view;
        renderLaunchList();
        if (view === 'live' && key && !(launchLiveState[key] && launchLiveState[key].data) && !launchLiveState[key]?.loading) {
          loadLiveRunbook(key, false);
        }
      }
      return;
    }
    const phaseToggle = e.target.closest('[data-launch-phase-toggle]');
    if (phaseToggle && root.contains(phaseToggle)) {
      const key = phaseToggle.getAttribute('data-launch-key');
      const phaseId = phaseToggle.getAttribute('data-launch-phase-toggle');
      if (key && phaseId) {
        const meta = getLaunchMeta(key);
        if (!meta.phases[phaseId]) meta.phases[phaseId] = {};
        meta.phases[phaseId].collapsed = !meta.phases[phaseId].collapsed;
        saveLaunchProgress();
        renderLaunchList();
      }
      return;
    }
    const secToggle = e.target.closest('[data-launch-section-toggle]');
    if (secToggle && root.contains(secToggle)) {
      const key = secToggle.getAttribute('data-launch-key');
      const sectionId = secToggle.getAttribute('data-launch-section-toggle');
      if (key && sectionId) {
        const meta = getLaunchMeta(key);
        if (!meta.sections[sectionId]) meta.sections[sectionId] = {};
        meta.sections[sectionId].collapsed = !meta.sections[sectionId].collapsed;
        saveLaunchProgress();
        renderLaunchList();
      }
      return;
    }
    const refreshBtn = e.target.closest('[data-launch-live-refresh]');
    if (refreshBtn && root.contains(refreshBtn)) {
      const key = refreshBtn.getAttribute('data-launch-live-refresh');
      if (key) loadLiveRunbook(key, true);
      return;
    }
    const chip = e.target.closest('.launch-status-chip');
    if (chip && root.contains(chip)) {
      const epicKey = chip.getAttribute('data-launch-progress');
      const rowId = chip.getAttribute('data-row');
      const env = chip.getAttribute('data-env');
      const val = chip.getAttribute('data-value');
      if (!epicKey || !rowId || !env || !val) return;
      if (!LAUNCH_CHECK_STATES.includes(val)) return;
      setLaunchProgress(epicKey, rowId, env, val);
      saveLaunchProgress();
      renderLaunchList();
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
    const phaseDone = e.target.closest('.launch-switch-input[data-launch-phase-complete]');
    if (phaseDone && root.contains(phaseDone)) {
      const key = phaseDone.getAttribute('data-launch-key');
      const phaseId = phaseDone.getAttribute('data-launch-phase-complete');
      if (key && phaseId) {
        const meta = getLaunchMeta(key);
        if (!meta.phases[phaseId]) meta.phases[phaseId] = {};
        meta.phases[phaseId].complete = phaseDone.checked;
        saveLaunchProgress();
        renderLaunchList();
      }
      return;
    }
    const showNa = e.target.closest('[data-launch-show-na]');
    if (showNa && root.contains(showNa)) {
      const key = showNa.getAttribute('data-launch-show-na');
      if (key) {
        launchShowNaSections[key] = showNa.checked;
        renderLaunchList();
      }
      return;
    }
    const na = e.target.closest('[data-launch-live-na]');
    if (na && root.contains(na)) {
      const key = na.getAttribute('data-launch-live-na');
      if (!key) return;
      launchLiveState[key] = Object.assign({}, launchLiveState[key] || {}, { showNa: na.checked });
      loadLiveRunbook(key, false);
    }
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
  epics.forEach((e) => {
    if (!e.config || !e.config.runbookUrl) return;
    const st = launchLiveState[e.key] || {};
    if (st.data || st.loading || st._prefetchAttempted) return;
    launchLiveState[e.key] = Object.assign({}, st, { _prefetchAttempted: true });
    loadLiveRunbook(e.key, false, { silent: true });
  });
  const expanded = launchExpandedKey;
  if (
    expanded &&
    launchDetailViewFor(expanded) === 'live' &&
    !(launchLiveState[expanded] && (launchLiveState[expanded].data || launchLiveState[expanded].loading || launchLiveState[expanded].error))
  ) {
    loadLiveRunbook(expanded, false);
  }
}

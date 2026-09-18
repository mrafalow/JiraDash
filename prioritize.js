/* ============================================================
   prioritize.js — ranking / “what to do next” (deterministic)
   ============================================================ */
const JIRA_BROWSE_BASE = 'https://disneyexperiences.atlassian.net/browse/';
function jiraLink(key){
  return (key && /^[A-Z][A-Z0-9]*-\d+$/.test(key)) ? JIRA_BROWSE_BASE + encodeURIComponent(key) : null;
}

const DEFAULT_BIZ = {
  RA_CREATE_BY: 2,
  RA_CLOSE_BY: 7,
  COND_CLOSE_BY: 8,
  PR_TURNAROUND: 2,
  TRANSLATIONS_WINDOW: 7
};
const BIZ = Object.assign({}, DEFAULT_BIZ);
const PRIORITY_MULT = {
  '1 - Critical': 1.4,
  '2 - High': 1.15,
  '3 - Medium': 1.0,
  '4 - Low': 0.8
};
const URGENCY = { MAX_MULT: 3.0, MIN_MULT: 0.3, DECAY_PER_DAY: 0.12 };
const SCORE_SCALE = 15;

const STAGE_LABELS = {
  RA: 'RA', COPY: 'Copy', MEDIA: 'Media', ALTTEXT: 'Alt Text', PR: 'PR',
  WF: 'WF', PRODVAL: 'PROD Val', TRANSLATIONS: 'Translations'
};

function atMidnight(d){
  if(typeof d === 'string'){
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  }
  const x = new Date(d); x.setHours(0,0,0,0); return x;
}
function isWeekend(d){ const w = d.getDay(); return w === 0 || w === 6; }
function addBusinessDays(date, n){
  let d = atMidnight(date), count = 0, step = n >= 0 ? 1 : -1;
  n = Math.abs(n);
  while(count < n){ d.setDate(d.getDate()+step); if(!isWeekend(d)) count++; }
  return d;
}
function businessDaysBetween(start, end){
  const a = atMidnight(start), b = atMidnight(end);
  const sign = b >= a ? 1 : -1;
  let lo = new Date(Math.min(a,b)), hi = new Date(Math.max(a,b)), count = 0;
  let d = new Date(lo);
  while(d < hi){ d.setDate(d.getDate()+1); if(!isWeekend(d)) count++; }
  return sign*count;
}
function todayMid(){ return atMidnight(new Date()); }
function fmtDate(d){
  if(!d) return '—';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3])).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

function parseChecklist(raDescription){
  if(!raDescription) return {found:false, altText:false, copy:false, media:false};
  const text = raDescription.replace(/\\(\[|\])/g, '$1');
  const result = {altText:false, copy:false, media:false};
  let found = false;

  const matches = [...text.matchAll(/\[([ xX])\]/g)];
  for(let i = 0; i < matches.length; i++){
    const checked = matches[i][1].toLowerCase() === 'x';
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i+1].index : text.length;
    const segment = text.slice(start, end).toLowerCase();
    if(segment.includes('alt text') && segment.includes('needed')){ found = true; result.altText = checked; }
    else if(segment.includes('copy needed')){ found = true; result.copy = checked; }
    else if(segment.includes('media needed')){ found = true; result.media = checked; }
  }
  return {found, ...result};
}

/** True when ticket uses Managed Services truncated Solo pipeline (no craft stages). */
function isManagedServicesTicket(ticket){
  return !!(ticket && (ticket.managedServices || ticket.scoringProfile === 'ms'));
}

/**
 * Stage model for scoring / next-action.
 * WDW (default): RA → Copy/Media/Alt (when needed) → PR → WF → Prod Val → Translations.
 * MS Solo: RA → PR → WF → Prod Val → Translations (skips Copy/Media/Alt/SEO craft).
 */
function buildStageModel(ticket){
  const day0 = atMidnight(ticket.createdDate);
  const due = atMidnight(ticket.dueDate);
  const today = todayMid();
  const isMs = isManagedServicesTicket(ticket);

  const subtasksByType = {};
  (ticket.subtasks || []).forEach(st => {
    if(!subtasksByType[st.type]) subtasksByType[st.type] = [];
    subtasksByType[st.type].push(st);
  });
  const get = (type) => (subtasksByType[type] || [])[0] || null;

  let needed = { COPY:false, MEDIA:false, ALTTEXT:false };
  const ra = get('RA');
  if(!isMs){
    const checklist = ra ? parseChecklist(ra.description) : {found:false};
    if(checklist.found){
      needed = { COPY: checklist.copy, MEDIA: checklist.media, ALTTEXT: checklist.altText };
    } else {
      needed = { COPY: !!get('COPY'), MEDIA: !!get('MEDIA'), ALTTEXT: !!get('ALTTEXT') };
    }
  }

  const checkpoints = [];

  checkpoints.push({ key:'RA created', expectedBy: addBusinessDays(day0, BIZ.RA_CREATE_BY), actualTrue: !!ra });
  checkpoints.push({ key:'RA closed', expectedBy: addBusinessDays(day0, BIZ.RA_CLOSE_BY), actualTrue: !!ra && ra.status === 'Closed' });

  if(!isMs){
    ['COPY','MEDIA','ALTTEXT'].forEach(type => {
      if(needed[type]){
        const st = get(type);
        checkpoints.push({ key: STAGE_LABELS[type]+' closed', expectedBy: addBusinessDays(day0, BIZ.COND_CLOSE_BY), actualTrue: !!st && st.status === 'Closed' });
      }
    });
  }

  let gateOpen = addBusinessDays(day0, BIZ.RA_CLOSE_BY);
  if(!isMs){
    ['COPY','MEDIA','ALTTEXT'].forEach(type => {
      if(needed[type]) gateOpen = new Date(Math.max(gateOpen, addBusinessDays(day0, BIZ.COND_CLOSE_BY)));
    });
  }
  const pr = get('PR');
  checkpoints.push({ key:'PR closed', expectedBy: addBusinessDays(gateOpen, BIZ.PR_TURNAROUND), actualTrue: !!pr && pr.status === 'Closed' });

  const wf = get('WF');
  checkpoints.push({ key:'WF closed', expectedBy: due, actualTrue: !!wf && wf.status === 'Closed' });

  const prodval = get('PRODVAL');
  checkpoints.push({ key:'PROD Val closed', expectedBy: due, actualTrue: !!prodval && prodval.status === 'Closed' });

  const actualPublishAnchor = (prodval && prodval.closedDate) ? atMidnight(prodval.closedDate) : due;
  const translations = get('TRANSLATIONS');
  checkpoints.push({ key:'Translations closed', expectedBy: addBusinessDays(actualPublishAnchor, BIZ.TRANSLATIONS_WINDOW), actualTrue: !!translations && translations.status === 'Closed' });

  const expectedIndex = checkpoints.filter(c => c.expectedBy <= today).length;
  const actualIndex = checkpoints.filter(c => c.actualTrue).length;
  const stageGap = Math.max(0, expectedIndex - actualIndex);

  const feasibleByDate = addBusinessDays(gateOpen, BIZ.PR_TURNAROUND);
  const timelineTight = feasibleByDate > due;

  const pipelineOrder = isMs
    ? ['RA','PR','WF','PRODVAL','TRANSLATIONS']
    : ['RA','COPY','MEDIA','ALTTEXT','PR','WF','PRODVAL','TRANSLATIONS'];
  function checkpointKeyForStageType(type){
    if(type === 'RA') return 'RA closed';
    if(type === 'PRODVAL') return 'PROD Val closed';
    return (STAGE_LABELS[type] || type) + ' closed';
  }

  let currentOpen = null;
  for(const type of pipelineOrder){
    if(type !== 'RA' && type !== 'PR' && type !== 'WF' && type !== 'PRODVAL' && type !== 'TRANSLATIONS' && !needed[type]) continue;
    const st = get(type);
    if(!st){ currentOpen = { type, missing:true }; break; }
    if(st.status !== 'Closed'){
      const cpKey = checkpointKeyForStageType(type);
      const cp = checkpoints.find(c => c.key === cpKey);
      currentOpen = {
        type,
        subtask: st,
        missing: false,
        expectedBy: cp ? cp.expectedBy : null
      };
      break;
    }
  }

  return {
    checkpoints, expectedIndex, actualIndex, stageGap, needed, currentOpen,
    totalStages: checkpoints.length, dueDate: due, day0, timelineTight,
    scoringProfile: isMs ? 'ms' : 'wdw'
  };
}

function computeScore(ticket, model){
  const today = todayMid();
  const daysUntilDue = businessDaysBetween(today, model.dueDate);

  const nothingStartedAndDueNow = model.actualIndex === 0 && daysUntilDue <= 0;
  if(nothingStartedAndDueNow){
    return { score: 100, band: 'red', daysUntilDue };
  }

  const urgencyMult = Math.max(URGENCY.MIN_MULT, Math.min(URGENCY.MAX_MULT, URGENCY.MAX_MULT - daysUntilDue * URGENCY.DECAY_PER_DAY));
  const priorityMult = PRIORITY_MULT[ticket.priority] || 1.0;
  const raw = model.stageGap * urgencyMult * SCORE_SCALE * priorityMult;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let band = 'blue';
  if(score >= 75) band = 'red';
  else if(score >= 50) band = 'orange';
  else if(score >= 25) band = 'gold';

  return { score, band, daysUntilDue };
}

const BAND_COLOR = { red:'var(--band-red)', orange:'var(--band-orange)', gold:'var(--band-gold)', blue:'var(--band-blue)' };
const BAND_BG = { red:'var(--band-red-bg)', orange:'var(--band-orange-bg)', gold:'var(--band-gold-bg)', blue:'var(--band-blue-bg)' };

function buildTag(ticket, model, scoring){
  const today = todayMid();
  if(model.actualIndex === 0 && scoring.daysUntilDue <= 0){
    return 'Nothing started · due ' + (scoring.daysUntilDue === 0 ? 'today' : 'overdue') + ' → Start RA now';
  }
  const co = model.currentOpen;
  if(!co){
    return 'All pipeline stages closed → Confirm publish &amp; wrap up';
  }
  const label = STAGE_LABELS[co.type] || co.type;
  if(co.missing){
    return label + ' not created · day ' + businessDaysBetween(model.day0, today) + ' → Create ' + label + ' subtask';
  }
  const st = co.subtask;
  const isMine = st.assigneeIsCurrentUser;
  const dayCount = businessDaysBetween(model.day0, today);
  const openDays = businessDaysBetween(st.createdDate, today);
  if(!isMine){
    return label + ' with ' + (st.assigneeName || 'assignee') + ' · open ' + openDays + 'd → Follow up with ' + (st.assigneeName || 'owner');
  }
  return label + ' open · day ' + dayCount + ' of pipeline → Move ' + label + ' forward';
}

function classifySubtaskType(summary){
  if(!summary) return null;
  const prefix = summary.split('|')[0].trim().toUpperCase();
  if(prefix === 'RA') return 'RA';
  if(prefix === 'PR') return 'PR';
  if(prefix === 'WF') return 'WF';
  if(prefix.indexOf('PROD VALIDATION') === 0) return 'PRODVAL';
  if(prefix.indexOf('TRANSLATION') === 0) return 'TRANSLATIONS';
  if(prefix === 'COPY') return 'COPY';
  if(prefix === 'MEDIA') return 'MEDIA';
  if(prefix.indexOf('ALT TEXT') === 0) return 'ALTTEXT';
  return null;
}

function normalizeFetchedData(data){
  const fixTicket = (t) => {
    (t.subtasks || []).forEach(st => {
      const classified = classifySubtaskType(st.summary);
      st.type = classified || (st.type ? String(st.type).toUpperCase() : null);
    });
    return t;
  };
  (data.activeTickets || []).forEach(fixTicket);
  (data.recentlyClosedTickets || []).forEach(fixTicket);
  // Recently Closed must stay WDW/own — never CONTENT delivery keys.
  data.recentlyClosedTickets = (data.recentlyClosedTickets || []).filter(t => {
    return !(t && t.key && String(t.key).toUpperCase().startsWith('CONTENT-'));
  });
  // CONTENT delivery portfolio (Owned by Managed Services) — light due-date order only.
  if(!Array.isArray(data.contentTickets)) data.contentTickets = [];
  data.contentTickets = data.contentTickets.slice().sort((a, b) => {
    const da = a.dueDate ? atMidnight(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const db = b.dueDate ? atMidnight(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    if(da !== db) return da - db;
    return String(a.key || '').localeCompare(String(b.key || ''));
  });
  // MS Solo inject: CONTENT assigned to current user with RA present — scored separately.
  if(!Array.isArray(data.msSoloTickets)) data.msSoloTickets = [];
  data.msSoloTickets = data.msSoloTickets.filter(t => {
    if(!t || !t.key || !String(t.key).toUpperCase().startsWith('CONTENT-')) return false;
    const hasRa = (t.subtasks || []).some(st => st && st.type === 'RA');
    return !!(t.assigneeIsCurrentUser && hasRa);
  });
  data.msSoloTickets.forEach(t => {
    t.managedServices = true;
    t.scoringProfile = 'ms';
  });
  return data;
}

function doNotPublishEarlyFromText(text){
  if(!text) return false;
  const t = text.toLowerCase();
  return t.includes('do not publish early') || t.includes('publish on or after') || t.includes('hold until');
}

/**
 * Solo Work lanes — urgency drives Needs Attention; Waiting never blocks it.
 * Dual lists: Attention+Waiting OK; Waiting+Action only when not Needs Attention.
 */
const SOLO_LANES = [
  { id: 'attention', title: 'Needs Attention', hint: 'Due soon or high urgency' },
  { id: 'action', title: 'My Action Items', hint: 'Yours to work — waiting items stay here unless urgent' },
  { id: 'waiting', title: 'Waiting on Others', hint: 'PR: overdue or past expected only. Other stages: due soon too. Partner/images: while craft is open and comments still block.' }
];
const DUE_SOON_DAYS = 2;
/** Subtask Jira due within this many business days → Waiting nudge (incl. PR). */
const SUBTASK_DUE_SOON_DAYS = 2;
const ATTENTION_SCORE_MIN = 50;

/** Soft check-in: still with MS, no RA, this many business days after create. */
const MS_CHECKIN_BIZ_DAYS = 5;
/** Hard MS stall: due within this many calendar days (or overdue), still with MS. */
const MS_STALL_DUE_WITHIN_DAYS = 10;

/** Calendar (not business) day delta from start → end at midnight. */
function calendarDaysBetween(start, end){
  const a = atMidnight(start), b = atMidnight(end);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function msSoloKeySet(data){
  const set = new Set();
  ((data && data.msSoloTickets) || []).forEach(t => {
    if(t && t.key) set.add(t.key);
  });
  return set;
}

function ticketHasRa(ticket){
  if(!ticket) return false;
  if(ticket.hasRa === true) return true;
  if(ticket.hasRa === false) return false;
  return (ticket.subtasks || []).some(st => st && st.type === 'RA');
}

/**
 * Parent statuses still on the starting line (CONTENT / MS portfolio).
 * Matches historical Studio Titan naming: Not Started, Open, To Do, Backlog.
 */
const CONTENT_START_STATUSES = ['Not Started', 'Open', 'To Do', 'Backlog'];

function normalizeStatusName(status){
  return String(status || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isContentStartStatus(status){
  const n = normalizeStatusName(status);
  return CONTENT_START_STATUSES.some(s => normalizeStatusName(s) === n);
}

function ticketHasAnySubtask(ticket){
  if(!ticket) return false;
  if(ticket.hasSubtasks === true) return true;
  if(ticket.hasSubtasks === false) return false;
  return (ticket.subtasks || []).length > 0;
}

/**
 * CONTENT portfolio "In motion": status left start line OR any subtask exists.
 * Portfolio stays unscored — this is a presence chip only.
 */
function contentMotionState(ticket){
  const reasons = [];
  const hasSub = ticketHasAnySubtask(ticket);
  const statusMoved = !isContentStartStatus(ticket && ticket.status);
  if(hasSub) reasons.push('Subtask created');
  if(statusMoved) reasons.push('Status moved');
  return { inMotion: hasSub || statusMoved, reasons };
}

/** CONTENT still with Managed Services — not yet MS Solo (assignee=you + RA). */
function isStillWithManagedServices(ticket, msSoloKeys){
  if(!ticket || !ticket.key || !String(ticket.key).toUpperCase().startsWith('CONTENT-')) return false;
  if(msSoloKeys && msSoloKeys.has(ticket.key)) return false;
  return true;
}

/**
 * Soft check-in: 5 business days after create, still with MS, still no RA.
 * Light signal only — never Needs Attention.
 */
function isMsCheckinSoft(ticket, msSoloKeys){
  if(!isStillWithManagedServices(ticket, msSoloKeys)) return false;
  if(ticketHasRa(ticket)) return false;
  if(!ticket.createdDate) return false;
  const ageBiz = businessDaysBetween(atMidnight(ticket.createdDate), todayMid());
  return ageBiz >= MS_CHECKIN_BIZ_DAYS;
}

/**
 * Hard MS stall: due exists and ≤10 calendar days away (or overdue), still with MS.
 * Inject into Needs Attention — no Solo pipeline scoring.
 */
function isMsStallHard(ticket, msSoloKeys){
  if(!isStillWithManagedServices(ticket, msSoloKeys)) return false;
  if(!ticket.dueDate) return false;
  const daysUntilDue = calendarDaysBetween(todayMid(), atMidnight(ticket.dueDate));
  return daysUntilDue <= MS_STALL_DUE_WITHIN_DAYS;
}

function msStallReason(ticket){
  if(!ticket || !ticket.dueDate) return 'MS stall';
  const days = calendarDaysBetween(todayMid(), atMidnight(ticket.dueDate));
  if(days < 0) return 'Past due — still with MS';
  if(days <= MS_STALL_DUE_WITHIN_DAYS) return 'Due soon — still with MS';
  return 'MS stall';
}

function msStallCalendarDueLabel(ticket){
  if(!ticket || !ticket.dueDate) return '—';
  const days = calendarDaysBetween(todayMid(), atMidnight(ticket.dueDate));
  if(days === 0) return 'Today';
  if(days < 0) return Math.abs(days) + 'd overdue';
  return 'In ' + days + 'd';
}

function collectMsCheckinTickets(data){
  const msSoloKeys = msSoloKeySet(data);
  return ((data && data.contentTickets) || []).filter(t => isMsCheckinSoft(t, msSoloKeys));
}

/** Hard stalls from CONTENT portfolio minus MS Solo — sorted by due date ascending. */
function collectMsStallTickets(data){
  const msSoloKeys = msSoloKeySet(data);
  return ((data && data.contentTickets) || [])
    .filter(t => isMsStallHard(t, msSoloKeys))
    .slice()
    .sort((a, b) => {
      const da = a.dueDate ? atMidnight(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const db = b.dueDate ? atMidnight(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if(da !== db) return da - db;
      return String(a.key || '').localeCompare(String(b.key || ''));
    });
}

/** Blocker “why” labels for Waiting nudge cards (standup rule 5). */
const BLOCKER_WHY = {
  RA: 'RA approval sitting with someone else',
  COPY: 'Copy needed from assignee',
  MEDIA: 'Media / assets needed from assignee',
  ALTTEXT: 'Alt text waiting on assignee',
  PR: 'Peer review pending',
  WF: 'Workflow unlock pending',
  PRODVAL: 'Prod validation pending',
  TRANSLATIONS: 'Translations pending'
};

function isOpenStageWithOtherAssignee(model){
  return !!(model.currentOpen && !model.currentOpen.missing &&
    model.currentOpen.subtask && model.currentOpen.subtask.assigneeIsCurrentUser === false);
}

/**
 * Subtask waiting counts for nudges only when overdue, due soon, or past Config expected-by.
 * PR never nudges on assignee alone (Ben / queued PR).
 */
function subtaskWaitNudgeReasons(model){
  if(!isOpenStageWithOtherAssignee(model)) return null;
  const co = model.currentOpen;
  const st = co.subtask;
  const today = todayMid();
  const reasons = [];

  if(st.dueDate){
    const daysUntilSubDue = businessDaysBetween(today, atMidnight(st.dueDate));
    if(daysUntilSubDue < 0) reasons.push('subtask_overdue');
    else if(co.type !== 'PR' && daysUntilSubDue <= SUBTASK_DUE_SOON_DAYS){
      reasons.push('subtask_due_soon');
    }
  }

  if(co.expectedBy && today > atMidnight(co.expectedBy)){
    reasons.push('past_expected');
  }

  if(!reasons.length) return null;
  return { type: co.type, reasons };
}

function isNudgeWorthySubtaskWait(model){
  return subtaskWaitNudgeReasons(model) != null;
}

function formatSubtaskWaitWhy(model, reasons){
  const co = model.currentOpen;
  const st = co && co.subtask;
  const parts = [];
  if(reasons.indexOf('subtask_overdue') >= 0 && st && st.dueDate){
    parts.push('subtask due ' + fmtDate(st.dueDate) + ' (overdue)');
  } else if(reasons.indexOf('subtask_due_soon') >= 0 && st && st.dueDate){
    parts.push('subtask due ' + fmtDate(st.dueDate) + ' (soon)');
  }
  if(reasons.indexOf('past_expected') >= 0 && co.expectedBy){
    parts.push('past expected ' + fmtDate(co.expectedBy) + ' (Config)');
  }
  return parts.join(' · ') || 'Pending with someone else';
}

function commentSignalsOf(ticket){
  return (ticket && ticket.commentSignals) || null;
}

/** Partner / image comment nudges only while craft stages are still open (not PR/WF and beyond). */
function imagesCommentStillRelevant(model){
  const co = model && model.currentOpen;
  if(!co) return false;
  const preMediaTypes = ['RA', 'COPY', 'MEDIA', 'ALTTEXT'];
  if(preMediaTypes.indexOf(co.type) >= 0) return true;
  if(co.missing && preMediaTypes.indexOf(co.type) >= 0) return true;
  return false;
}

/** True when recent comments say we're blocked / waiting on someone else. */
function isWaitingOnComments(model, ticket){
  const sig = commentSignalsOf(ticket);
  if(!sig || !sig.waitingOnOthers) return false;
  if(sig.waitingOnImages || sig.waitingOnPartnerAssets){
    return imagesCommentStillRelevant(model);
  }
  return true;
}

/**
 * Partner owes images/assets before Media handoff — Partner field set + comment signal.
 */
function isWaitingOnPartnerAssets(ticket, model){
  const sig = commentSignalsOf(ticket);
  if(!(ticket && ticket.partner && sig && sig.waitingOnPartnerAssets)) return false;
  return imagesCommentStillRelevant(model);
}

function isWaitingOnOthers(model, ticket){
  return isNudgeWorthySubtaskWait(model) || isWaitingOnComments(model, ticket);
}

/** True when scoring / pipeline timing says this ticket Needs Attention. */
function meetsNeedsAttention(scoring){
  if(!scoring) return false;
  const dueSoon = typeof scoring.daysUntilDue === 'number' && scoring.daysUntilDue <= DUE_SOON_DAYS;
  const highScore = typeof scoring.score === 'number' && scoring.score >= ATTENTION_SCORE_MIN;
  return dueSoon || highScore;
}

/**
 * Primary Solo lane — urgency (Needs Attention) wins over Waiting; Waiting wins over Action.
 * Membership for dual-list rendering uses soloLanesForTicket.
 */
function classifySoloLane(ticket, model, scoring){
  if(meetsNeedsAttention(scoring)) return 'attention';
  if(isWaitingOnOthers(model, ticket)) return 'waiting';
  return 'action';
}

/**
 * All Solo sections a ticket should appear in.
 * - Needs Attention + Waiting: dual list (urgency + nudge)
 * - Waiting only (not urgent): dual list into Action
 * - Needs Attention alone: Attention only (not duplicated into Action)
 */
function soloLanesForTicket(ticket, model, scoring){
  const attention = meetsNeedsAttention(scoring);
  const waiting = isWaitingOnOthers(model, ticket);
  if(attention && waiting) return ['attention', 'waiting'];
  if(attention) return ['attention'];
  if(waiting) return ['waiting', 'action'];
  return ['action'];
}

function firstNameFromDisplay(name){
  if(!name) return 'there';
  const part = String(name).trim().split(/\s+/)[0];
  return part || 'there';
}

function dueLabelFromScoring(scoring){
  let dueLabel = '—';
  if(scoring && typeof scoring.daysUntilDue === 'number'){
    if(scoring.daysUntilDue === 0) dueLabel = 'Today';
    else if(scoring.daysUntilDue < 0) dueLabel = Math.abs(scoring.daysUntilDue) + 'd overdue';
    else dueLabel = 'In ' + scoring.daysUntilDue + 'd';
  }
  return dueLabel;
}

/**
 * Ready-to-send Waiting nudge payload for a ticket already in the waiting lane.
 * Returns null when the ticket is not blocked on someone else.
 * Partner + waiting-on-images comments → nudge aimed at Partner (not Media yet).
 */
function buildWaitingNudge(ticket, model, scoring){
  if(!isWaitingOnOthers(model, ticket)) return null;

  const dueLabel = dueLabelFromScoring(scoring);
  const dueFmt = fmtDate(ticket.dueDate);
  const summary = (ticket.summary || '').trim() || ticket.key;
  const sig = commentSignalsOf(ticket);

  // Partner owes assets — prefer Partner-oriented nudge over Media subtask assignee.
  if(isWaitingOnPartnerAssets(ticket, model)){
    const partnerName = ticket.partner;
    const first = firstNameFromDisplay(partnerName);
    let why = 'Waiting on images/assets from Partner before Media handoff';
    if(sig && sig.dateAdjusted) why += ' · due date adjusted';
    const dateBit = (sig && sig.dateAdjusted) ? ' Date was adjusted.' : '';
    const nudgeText = 'Hi ' + first + ' — gentle nudge: still waiting on images/assets for "' +
      summary + '" (' + ticket.key + ').' + dateBit + ' Due ' + dueFmt +
      '. Any ETA before we hand off to Media? Thanks!';
    return {
      blockerType: 'Partner assets',
      blockerWhy: why,
      assigneeName: partnerName,
      dueLabel,
      dueFmt,
      openDays: null,
      nudgeText,
      subtaskKey: null,
      stageType: 'PARTNER'
    };
  }

  const subtaskWait = subtaskWaitNudgeReasons(model);
  if(subtaskWait){
    const co = model.currentOpen;
    const st = co.subtask;
    const type = subtaskWait.type;
    const reasons = subtaskWait.reasons;
    const blockerType = STAGE_LABELS[type] || type || 'Blocker';
    let blockerWhy = BLOCKER_WHY[type] || (blockerType + ' pending with someone else');
    blockerWhy += ' · ' + formatSubtaskWaitWhy(model, reasons);
    if(sig && sig.waitingOnImages) blockerWhy += ' · comments mention waiting on images/assets';
    else if(sig && sig.dateAdjusted) blockerWhy += ' · comments mention due date adjusted';
    const assigneeName = st.assigneeName || 'Unassigned';
    const today = todayMid();
    const openDays = st.createdDate != null ? businessDaysBetween(atMidnight(st.createdDate), today) : null;
    const first = firstNameFromDisplay(st.assigneeName);
    const openBit = openDays != null ? ' (open ' + openDays + 'd)' : '';
    const subDueFmt = st.dueDate ? fmtDate(st.dueDate) : dueFmt;
    let nudgeText = 'Hi ' + first + ' — gentle nudge on ' + blockerType + ' for "' + summary +
      '" (' + ticket.key + ')' + openBit + '. Subtask due ' + subDueFmt + '; parent due ' + dueFmt + '. Any ETA? Thanks!';
    if(reasons.indexOf('past_expected') >= 0 && co.expectedBy){
      nudgeText = 'Hi ' + first + ' — gentle nudge on ' + blockerType + ' for "' + summary +
        '" (' + ticket.key + ')' + openBit + '. Expected by ' + fmtDate(co.expectedBy) + ' (Config). Subtask due ' +
        subDueFmt + '. Any ETA? Thanks!';
    }
    if(sig && sig.waitingOnImages){
      nudgeText = 'Hi ' + first + ' — gentle nudge on ' + blockerType + ' for "' + summary +
        '" (' + ticket.key + ')' + openBit + '. Still waiting on images/assets. Subtask due ' + subDueFmt + '. Any ETA? Thanks!';
    } else if(sig && sig.dateAdjusted){
      nudgeText = 'Hi ' + first + ' — gentle nudge on ' + blockerType + ' for "' + summary +
        '" (' + ticket.key + ')' + openBit + '. Due date was adjusted — parent due ' + dueFmt + '. Any ETA? Thanks!';
    }
    return {
      blockerType,
      blockerWhy,
      assigneeName,
      dueLabel,
      dueFmt,
      openDays,
      nudgeText,
      subtaskKey: st.key || null,
      stageType: type
    };
  }

  // Comment-only waiting (no subtask assignee blocker).
  let blockerType = 'Waiting';
  let blockerWhy = 'Blocked per recent comment';
  let nudgeFocus = 'this item';
  if(sig && sig.waitingOnImages){
    blockerType = 'Images / assets';
    blockerWhy = 'Waiting on images/assets (from comments)';
    nudgeFocus = 'images/assets';
  } else if(sig && sig.dateAdjusted){
    blockerType = 'Date change';
    blockerWhy = 'Due date adjusted (from comments)';
    nudgeFocus = 'the adjusted due date';
  }
  if(sig && sig.matchSnippet){
    blockerWhy += ' — "' + sig.matchSnippet.slice(0, 80) + (sig.matchSnippet.length > 80 ? '…' : '') + '"';
  }
  const who = ticket.partner || 'there';
  const first = firstNameFromDisplay(who);
  const dateBit = (sig && sig.dateAdjusted) ? ' Date was adjusted.' : '';
  const nudgeText = 'Hi ' + first + ' — gentle nudge: still waiting on ' + nudgeFocus + ' for "' +
    summary + '" (' + ticket.key + ').' + dateBit + ' Due ' + dueFmt + '. Any ETA? Thanks!';

  return {
    blockerType,
    blockerWhy,
    assigneeName: ticket.partner || 'Someone else',
    dueLabel,
    dueFmt,
    openDays: null,
    nudgeText,
    subtaskKey: null,
    stageType: 'COMMENT'
  };
}

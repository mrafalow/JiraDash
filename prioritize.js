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

function buildStageModel(ticket){
  const day0 = atMidnight(ticket.createdDate);
  const due = atMidnight(ticket.dueDate);
  const today = todayMid();

  const subtasksByType = {};
  (ticket.subtasks || []).forEach(st => {
    if(!subtasksByType[st.type]) subtasksByType[st.type] = [];
    subtasksByType[st.type].push(st);
  });
  const get = (type) => (subtasksByType[type] || [])[0] || null;

  let needed = { COPY:false, MEDIA:false, ALTTEXT:false };
  const ra = get('RA');
  const checklist = ra ? parseChecklist(ra.description) : {found:false};
  if(checklist.found){
    needed = { COPY: checklist.copy, MEDIA: checklist.media, ALTTEXT: checklist.altText };
  } else {
    needed = { COPY: !!get('COPY'), MEDIA: !!get('MEDIA'), ALTTEXT: !!get('ALTTEXT') };
  }

  const checkpoints = [];

  checkpoints.push({ key:'RA created', expectedBy: addBusinessDays(day0, BIZ.RA_CREATE_BY), actualTrue: !!ra });
  checkpoints.push({ key:'RA closed', expectedBy: addBusinessDays(day0, BIZ.RA_CLOSE_BY), actualTrue: !!ra && ra.status === 'Closed' });

  ['COPY','MEDIA','ALTTEXT'].forEach(type => {
    if(needed[type]){
      const st = get(type);
      checkpoints.push({ key: STAGE_LABELS[type]+' closed', expectedBy: addBusinessDays(day0, BIZ.COND_CLOSE_BY), actualTrue: !!st && st.status === 'Closed' });
    }
  });

  let gateOpen = addBusinessDays(day0, BIZ.RA_CLOSE_BY);
  ['COPY','MEDIA','ALTTEXT'].forEach(type => {
    if(needed[type]) gateOpen = new Date(Math.max(gateOpen, addBusinessDays(day0, BIZ.COND_CLOSE_BY)));
  });
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

  const pipelineOrder = ['RA','COPY','MEDIA','ALTTEXT','PR','WF','PRODVAL','TRANSLATIONS'];
  let currentOpen = null;
  for(const type of pipelineOrder){
    if(type !== 'RA' && type !== 'PR' && type !== 'WF' && type !== 'PRODVAL' && type !== 'TRANSLATIONS' && !needed[type]) continue;
    const st = get(type);
    if(!st){ currentOpen = { type, missing:true }; break; }
    if(st.status !== 'Closed'){ currentOpen = { type, subtask: st, missing:false }; break; }
  }

  return { checkpoints, expectedIndex, actualIndex, stageGap, needed, currentOpen, totalStages: checkpoints.length, dueDate: due, day0, timelineTight };
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
  return data;
}

function doNotPublishEarlyFromText(text){
  if(!text) return false;
  const t = text.toLowerCase();
  return t.includes('do not publish early') || t.includes('publish on or after') || t.includes('hold until');
}

/** Solo Work lanes — exclusive: waiting > attention > action */
const SOLO_LANES = [
  { id: 'attention', title: 'Needs Attention', hint: 'Due soon or high urgency' },
  { id: 'action', title: 'My Action Items', hint: 'Yours — not in the fire queue' },
  { id: 'waiting', title: 'Waiting on Others', hint: 'Blocked on someone else — draft nudge ready to send' }
];
const DUE_SOON_DAYS = 2;
const ATTENTION_SCORE_MIN = 50;

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

function isWaitingOnOthers(model){
  return !!(model.currentOpen && !model.currentOpen.missing &&
    model.currentOpen.subtask && model.currentOpen.subtask.assigneeIsCurrentUser === false);
}

function classifySoloLane(ticket, model, scoring){
  if(isWaitingOnOthers(model)) return 'waiting';
  const dueSoon = scoring.daysUntilDue <= DUE_SOON_DAYS;
  const highScore = scoring.score >= ATTENTION_SCORE_MIN;
  if(dueSoon || highScore) return 'attention';
  return 'action';
}

function firstNameFromDisplay(name){
  if(!name) return 'there';
  const part = String(name).trim().split(/\s+/)[0];
  return part || 'there';
}

/**
 * Ready-to-send Waiting nudge payload for a ticket already in the waiting lane.
 * Returns null when the ticket is not blocked on someone else.
 */
function buildWaitingNudge(ticket, model, scoring){
  if(!isWaitingOnOthers(model)) return null;
  const co = model.currentOpen;
  const st = co.subtask;
  const type = co.type;
  const blockerType = STAGE_LABELS[type] || type || 'Blocker';
  const blockerWhy = BLOCKER_WHY[type] || (blockerType + ' pending with someone else');
  const assigneeName = st.assigneeName || 'Unassigned';
  const today = todayMid();
  const openDays = st.createdDate != null ? businessDaysBetween(atMidnight(st.createdDate), today) : null;
  let dueLabel = '—';
  if(scoring && typeof scoring.daysUntilDue === 'number'){
    if(scoring.daysUntilDue === 0) dueLabel = 'Today';
    else if(scoring.daysUntilDue < 0) dueLabel = Math.abs(scoring.daysUntilDue) + 'd overdue';
    else dueLabel = 'In ' + scoring.daysUntilDue + 'd';
  }
  const dueFmt = fmtDate(ticket.dueDate);
  const summary = (ticket.summary || '').trim() || ticket.key;
  const first = firstNameFromDisplay(st.assigneeName);
  const openBit = openDays != null ? ' (open ' + openDays + 'd)' : '';
  const nudgeText = 'Hi ' + first + ' — gentle nudge on ' + blockerType + ' for "' + summary +
    '" (' + ticket.key + ')' + openBit + '. Due ' + dueFmt + '. Any ETA? Thanks!';

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

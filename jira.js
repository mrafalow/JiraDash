/* ============================================================
   jira.js — fetch tickets via local server proxy (Basic Auth from .env)
   ============================================================ */

function datePrefix(value){
  if(!value) return null;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function adfToText(node){
  if(!node) return '';
  if(typeof node === 'string') return node;
  if(Array.isArray(node)) return node.map(adfToText).join('');
  if(node.type === 'text') return node.text || '';
  if(node.type === 'hardBreak') return '\n';
  if(node.type === 'mention') return (node.attrs && node.attrs.text) || '';
  if(node.type === 'emoji') return (node.attrs && (node.attrs.shortName || node.attrs.text)) || '';
  if(node.type === 'inlineCard' || node.type === 'blockCard'){
    return (node.attrs && (node.attrs.url || node.attrs.href)) || '';
  }
  if(node.type === 'taskItem'){
    const checked = node.attrs && String(node.attrs.state || '').toUpperCase() === 'DONE' ? 'x' : ' ';
    const inner = adfToText(node.content || []);
    return '[' + checked + '] ' + inner + '\n';
  }
  const inner = adfToText(node.content || []);
  if(node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem'){
    return inner + '\n';
  }
  return inner;
}

function descriptionToText(description){
  if(!description) return '';
  if(typeof description === 'string') return description;
  return adfToText(description).trim();
}

async function jiraFetch(path, options){
  const res = await fetch('/api/jira' + path, options);
  let body = null;
  const text = await res.text();
  try{ body = text ? JSON.parse(text) : null; } catch(_){ body = text; }
  if(!res.ok){
    const msg = (body && body.errorMessages && body.errorMessages.join('; '))
      || (body && body.message)
      || (typeof body === 'string' && body.slice(0, 200))
      || ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function jiraSearch(jql, fields, maxResults){
  // Legacy /rest/api/3/search is gone (HTTP 410). Use /search/jql (POST).
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql,
      fields: fields || undefined,
      maxResults: maxResults || 50
    })
  });
  return data.issues || [];
}

function mapPriority(fields){
  return (fields.priority && fields.priority.name) || null;
}

function mapStatusName(fields){
  return (fields.status && fields.status.name) || 'Open';
}

function mapAssignee(fields, currentAccountId){
  const a = fields.assignee;
  if(!a) return { assigneeName: null, assigneeIsCurrentUser: false };
  return {
    assigneeName: a.displayName || a.name || null,
    assigneeIsCurrentUser: !!(currentAccountId && a.accountId === currentAccountId)
  };
}

/** Discovered via /rest/api/3/field (name "Partner"). Override with JIRA_PARTNER_FIELD in .env. */
const DEFAULT_PARTNER_FIELD = 'customfield_10329';
/** Publish Early radio — already used historically as customfield_10182. */
const DEFAULT_PUBLISH_EARLY_FIELD = 'customfield_10182';
/**
 * CONTENT delivery ownership (Step 6).
 * Verified live: reporter = currentUser() OR assignee = currentUser() → 5 open parents
 * (all reporter=Marcin, assignee=MS). watcher = currentUser() → 0. Override with JIRA_CONTENT_JQL.
 */
const DEFAULT_CONTENT_JQL =
  'project = CONTENT AND (reporter = currentUser() OR assignee = currentUser()) AND issuetype != Sub-task AND statusCategory != Done ORDER BY duedate ASC';

const SOLO_PROJECT_KEY = 'WDW';

async function assertSoloProjectVisible(){
  try{
    await jiraFetch('/rest/api/3/project/' + encodeURIComponent(SOLO_PROJECT_KEY));
  } catch(err){
    if(err.status === 404){
      throw new Error(
        'Connected to Jira, but this API token cannot see project ' + SOLO_PROJECT_KEY + '. ' +
        'The work token may differ from home — use the same token as home (with JIRA_CLOUD_ID) so the Platform gateway can load tickets.'
      );
    }
    throw err;
  }
}

function customFieldText(raw){
  if(raw == null || raw === '') return null;
  if(typeof raw === 'string'){
    const s = raw.trim();
    return s || null;
  }
  if(Array.isArray(raw)){
    const parts = raw.map(customFieldText).filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  if(typeof raw === 'object'){
    if(raw.value != null) return String(raw.value);
    if(raw.displayName != null) return String(raw.displayName);
    if(raw.name != null) return String(raw.name);
  }
  return null;
}

function publishEarlyValue(fields, fieldId){
  return customFieldText(fields[fieldId || DEFAULT_PUBLISH_EARLY_FIELD]);
}

function partnerValue(fields, fieldId){
  return customFieldText(fields[fieldId || DEFAULT_PARTNER_FIELD]);
}

async function resolveCustomFieldIds(){
  try{
    const res = await fetch('/api/config');
    if(res.ok){
      const cfg = await res.json();
      return {
        partnerField: (cfg && cfg.partnerField) || DEFAULT_PARTNER_FIELD,
        publishEarlyField: (cfg && cfg.publishEarlyField) || DEFAULT_PUBLISH_EARLY_FIELD,
        contentJql: (cfg && cfg.contentJql) || null
      };
    }
  } catch(_){ /* use defaults */ }
  return {
    partnerField: DEFAULT_PARTNER_FIELD,
    publishEarlyField: DEFAULT_PUBLISH_EARLY_FIELD,
    contentJql: null
  };
}

function mapSubtask(issue, currentAccountId, includeDescription){
  const f = issue.fields || {};
  const assignee = mapAssignee(f, currentAccountId);
  const summary = f.summary || '';
  const mapped = {
    type: classifySubtaskType(summary),
    summary,
    key: issue.key,
    status: mapStatusName(f),
    assigneeName: assignee.assigneeName,
    assigneeIsCurrentUser: assignee.assigneeIsCurrentUser,
    createdDate: datePrefix(f.created),
    closedDate: datePrefix(f.resolutiondate)
  };
  if(includeDescription || mapped.type === 'RA'){
    mapped.description = descriptionToText(f.description);
  }
  return mapped;
}

function groupByParent(subtaskIssues, currentAccountId, includeRaDescription){
  const byParent = {};
  for(const issue of subtaskIssues){
    const parentKey = issue.fields && issue.fields.parent && issue.fields.parent.key;
    if(!parentKey) continue;
    if(!byParent[parentKey]) byParent[parentKey] = [];
    const isRa = classifySubtaskType(issue.fields && issue.fields.summary) === 'RA';
    byParent[parentKey].push(mapSubtask(issue, currentAccountId, includeRaDescription && isRa));
  }
  return byParent;
}

function mapActiveTicket(issue, subtasksByParent, currentAccountId, fieldIds, commentSignalsByKey){
  const f = issue.fields || {};
  const subtasks = (subtasksByParent[issue.key] || []).slice();
  const ticketDesc = descriptionToText(f.description);
  const ra = subtasks.find(s => s.type === 'RA');
  const override = doNotPublishEarlyFromText(ticketDesc) || doNotPublishEarlyFromText(ra && ra.description);
  const ids = fieldIds || {};
  const assignee = mapAssignee(f, currentAccountId);
  const commentSignals = (commentSignalsByKey && commentSignalsByKey[issue.key])
    || analyzeCommentSignals([]);
  return {
    key: issue.key,
    summary: f.summary || '',
    priority: mapPriority(f),
    status: mapStatusName(f),
    assigneeName: assignee.assigneeName,
    assigneeIsCurrentUser: assignee.assigneeIsCurrentUser,
    createdDate: datePrefix(f.created),
    dueDate: datePrefix(f.duedate),
    partner: partnerValue(f, ids.partnerField),
    publishEarlyField: publishEarlyValue(f, ids.publishEarlyField),
    doNotPublishEarlyOverride: !!override,
    subtasks,
    commentSignals
  };
}

function mapClosedTicket(issue, subtasksByParent, currentAccountId){
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary || '',
    priority: mapPriority(f),
    dueDate: datePrefix(f.duedate),
    closedDate: datePrefix(f.resolutiondate),
    subtasks: (subtasksByParent[issue.key] || []).slice()
  };
}

/** CONTENT- delivery remotes — flat row for footer section (not scored into Solo lanes). */
function mapContentTicket(issue, currentAccountId, fieldIds){
  const f = issue.fields || {};
  const assignee = mapAssignee(f, currentAccountId);
  const ids = fieldIds || {};
  return {
    key: issue.key,
    summary: f.summary || '',
    status: mapStatusName(f),
    assigneeName: assignee.assigneeName,
    dueDate: datePrefix(f.duedate),
    partner: partnerValue(f, ids.partnerField),
    priority: mapPriority(f)
  };
}

async function fetchContentTickets(currentAccountId, fieldIds){
  const jql = (fieldIds && fieldIds.contentJql) || DEFAULT_CONTENT_JQL;
  const fields = [
    'summary', 'status', 'assignee', 'duedate', 'priority',
    fieldIds.partnerField || DEFAULT_PARTNER_FIELD
  ];
  try{
    const issues = await jiraSearch(jql, fields, 50);
    return {
      jql,
      tickets: issues.map(i => mapContentTicket(i, currentAccountId, fieldIds))
    };
  } catch(err){
    // CONTENT project may be unavailable for some tokens — keep WDW board working.
    console.warn('[jira] CONTENT fetch failed:', err.message || err);
    return { jql, tickets: [], error: err.message || String(err) };
  }
}

async function fetchSubtasksForParents(keys, currentAccountId, includeRaDescription){
  if(!keys.length) return {};
  // Jira JQL parent in (...) — chunk to stay under URL limits
  const chunks = [];
  for(let i = 0; i < keys.length; i += 40) chunks.push(keys.slice(i, i + 40));
  const all = [];
  for(const chunk of chunks){
    const jql = 'parent in (' + chunk.join(',') + ')';
    const fields = ['summary','status','assignee','created','resolutiondate','description','parent'];
    const issues = await jiraSearch(jql, fields, 200);
    all.push(...issues);
  }
  return groupByParent(all, currentAccountId, includeRaDescription);
}

/** How many newest comments to scan per parent for Waiting / Partner signals. */
const COMMENT_SCAN_MAX = 25;

/**
 * Heuristics over recent comment text (case-insensitive) for Solo Waiting lane.
 * v1: waiting for/on images|assets|photos; due/date adjusted|pushed|moved; general waiting-on.
 * Also catches Partner photo/image delivery phrasing (Turf Club-style notes).
 */
function analyzeCommentSignals(commentTexts){
  const joined = (commentTexts || []).filter(Boolean).join('\n').toLowerCase();
  if(!joined.trim()){
    return {
      waitingOnOthers: false,
      waitingOnImages: false,
      dateAdjusted: false,
      waitingOnPartnerAssets: false,
      matchSnippet: null
    };
  }

  const waitingOnImages = /waiting\s+(?:for|on)\s+(?:the\s+)?(?:images?|assets?|photos?)/.test(joined)
    || /(?:need(?:s|ed)?|awaiting)\s+(?:images?|assets?|photos?)\s+(?:from|before)/.test(joined)
    || /(?:images?|assets?|photos?)\s+from\s+(?:partner|dakota)/.test(joined)
    || /from\s+partner\s+(?:before|for)\b/.test(joined)
    // Turf Club-style: "have photos sent… once the images are added"
    || /(?:have|get|need)\s+(?:photos?|images?|assets?)\s+sent/.test(joined)
    || /once\s+(?:the\s+)?(?:images?|photos?|assets?)\s+(?:are\s+)?added/.test(joined)
    || /(?:note|ask(?:ing)?|asked)\s+to\s+partner.*(?:photos?|images?|assets?)/.test(joined)
    || /partner.*(?:photos?|images?|assets?).*(?:sent|add|deliver)/.test(joined)
    || /(?:photos?|images?|assets?).*(?:from|to)\s+partner/.test(joined)
    || /sent\s+note\s+to\s+partner/.test(joined) && /(?:photos?|images?|assets?)/.test(joined);

  const dateAdjusted = /(?:due|date)\s+(?:was\s+)?(?:adjusted|pushed|moved|changed|shifted)/.test(joined)
    || /(?:adjusted|pushed|moved|changed|shifted)\s+(?:the\s+)?(?:due\s+)?date/.test(joined)
    || /date\s+(?:adjustment|change|push)/.test(joined);

  const waitingOn = /waiting\s+(?:for|on)\b/.test(joined)
    || /blocked\s+(?:on|by)\b/.test(joined)
    || /holding\s+(?:for|on)\b/.test(joined)
    || /still\s+need(?:s|ed)?\b/.test(joined);

  const waitingOnOthers = waitingOnImages || dateAdjusted || waitingOn;
  const waitingOnPartnerAssets = waitingOnImages;

  let matchSnippet = null;
  if(waitingOnOthers){
    const source = (commentTexts || []).find(t => {
      const low = String(t || '').toLowerCase();
      return /waiting\s+(?:for|on)|blocked\s+(?:on|by)|(?:due|date).*(?:adjusted|pushed|moved)|(?:images?|assets?|photos?)|partner/.test(low);
    }) || commentTexts[0];
    matchSnippet = String(source || '').replace(/\s+/g, ' ').trim().slice(0, 140) || null;
  }

  return {
    waitingOnOthers,
    waitingOnImages,
    dateAdjusted,
    waitingOnPartnerAssets,
    matchSnippet
  };
}

function commentBodyToText(body){
  if(!body) return '';
  if(typeof body === 'string') return body;
  return adfToText(body).trim();
}

/**
 * Fetch recent comments for parent keys via existing /api/jira proxy.
 * On 401/scope failure, returns { byKey: {}, error } so the board still loads
 * and we stop hammering the gateway once scope is clearly missing.
 */
async function fetchCommentsForParents(keys){
  if(!keys.length) return { byKey: {}, error: null };
  const byKey = {};
  let firstError = null;
  let scopeBlocked = false;

  const CONCURRENCY = 5;
  for(let i = 0; i < keys.length; i += CONCURRENCY){
    if(scopeBlocked) break;
    const chunk = keys.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (key) => {
      if(scopeBlocked){
        byKey[key] = analyzeCommentSignals([]);
        return;
      }
      try{
        const data = await jiraFetch(
          '/rest/api/3/issue/' + encodeURIComponent(key) +
          '/comment?maxResults=' + COMMENT_SCAN_MAX + '&orderBy=-created'
        );
        const comments = (data && data.comments) || [];
        const texts = comments.map(c => commentBodyToText(c && c.body)).filter(Boolean);
        byKey[key] = analyzeCommentSignals(texts);
      } catch(err){
        if(!firstError) firstError = err;
        const status = err && err.status;
        const msg = (err && err.message) || '';
        if(status === 401 || status === 403 || /scope/i.test(msg)){
          scopeBlocked = true;
        }
        byKey[key] = analyzeCommentSignals([]);
      }
    }));
  }

  // Fill remaining keys with empty signals if we aborted early.
  for(const key of keys){
    if(!byKey[key]) byKey[key] = analyzeCommentSignals([]);
  }

  let error = null;
  if(firstError){
    const status = firstError.status;
    const msg = firstError.message || String(firstError);
    if(status === 401 || status === 403 || /scope/i.test(msg)){
      error = 'Comments could not be read (token needs read:jira-work / comment access). ' +
        'Waiting lane will use subtasks only until comments are available. Details: ' + msg;
    } else {
      error = 'Comments fetch failed: ' + msg;
    }
  }

  return { byKey, error };
}

/**
 * Fetch board-shaped payload matching Studio Titan expectations.
 * Credentials never leave the local proxy (see server.js).
 */
async function fetchJiraData(){
  // /myself needs read:jira-user. Scoped tokens with only read:jira-work will fail here —
  // continue via search (currentUser() still works under read:jira-work).
  let currentAccountId = null;
  let currentUserFirstName = null;
  try{
    const me = await jiraFetch('/rest/api/3/myself');
    currentAccountId = me.accountId || null;
    const displayName = me.displayName || '';
    currentUserFirstName = displayName.split(/\s+/)[0] || displayName || null;
  } catch(err){
    if(err.status === 503 || /not configured|missing/i.test(err.message)){
      throw new Error(err.message || 'Jira credentials missing. Set JIRA_EMAIL and JIRA_API_TOKEN in .env.');
    }
    if(!(err.status === 401 || err.status === 403)){
      throw err;
    }
    // Scope or classic auth failure on /myself — probe search before hard-failing.
  }

  const fieldIds = await resolveCustomFieldIds();
  const parentFields = [
    'summary','priority','duedate','created','status','description',
    fieldIds.publishEarlyField, fieldIds.partnerField,
    'resolutiondate','assignee'
  ];

  let activeIssues;
  try{
    activeIssues = await jiraSearch(
      'project = WDW AND (assignee = currentUser() OR reporter = currentUser()) AND issuetype != Sub-task AND status != Closed ORDER BY duedate ASC',
      parentFields,
      50
    );
  } catch(err){
    if(err.status === 401 || err.status === 403){
      throw new Error('Jira rejected the credentials in .env (check JIRA_EMAIL, JIRA_API_TOKEN, and for scoped tokens JIRA_CLOUD_ID).');
    }
    throw err;
  }

  if(!activeIssues.length){
    await assertSoloProjectVisible();
  }

  // Scoped tokens often lack read:jira-user (/myself 401). Probe assignee =
  // currentUser() so Waiting-lane "is this mine?" checks still work.
  if(!currentAccountId){
    try{
      const probe = await jiraSearch('assignee = currentUser() ORDER BY updated DESC', ['assignee'], 1);
      const a = probe[0] && probe[0].fields && probe[0].fields.assignee;
      if(a && a.accountId) currentAccountId = a.accountId;
      if(!currentUserFirstName && a && (a.displayName || a.name)){
        currentUserFirstName = String(a.displayName || a.name).split(/\s+/)[0];
      }
    } catch(_){ /* leave null — Waiting falls back to "not mine" */ }
  }

  if(!currentUserFirstName){
    const sample = activeIssues[0] && activeIssues[0].fields && activeIssues[0].fields.assignee;
    const dn = sample && (sample.displayName || sample.name);
    if(dn) currentUserFirstName = String(dn).split(/\s+/)[0];
  }

  const closedIssues = await jiraSearch(
    'project = WDW AND (assignee = currentUser() OR reporter = currentUser()) AND issuetype != Sub-task AND status = Closed ORDER BY resolutiondate DESC',
    parentFields,
    15
  );

  const activeKeys = activeIssues.map(i => i.key);
  const closedKeys = closedIssues.map(i => i.key);

  const [activeSubs, closedSubs, contentResult, commentsResult] = await Promise.all([
    fetchSubtasksForParents(activeKeys, currentAccountId, true),
    fetchSubtasksForParents(closedKeys, currentAccountId, false),
    fetchContentTickets(currentAccountId, fieldIds),
    fetchCommentsForParents(activeKeys)
  ]);

  const commentSignalsByKey = (commentsResult && commentsResult.byKey) || {};

  return {
    currentUserFirstName,
    activeTickets: activeIssues.map(i => mapActiveTicket(i, activeSubs, currentAccountId, fieldIds, commentSignalsByKey)),
    recentlyClosedTickets: closedIssues.map(i => mapClosedTicket(i, closedSubs, currentAccountId)),
    contentTickets: contentResult.tickets || [],
    contentJql: contentResult.jql || DEFAULT_CONTENT_JQL,
    commentsWarning: (commentsResult && commentsResult.error) || null
  };
}

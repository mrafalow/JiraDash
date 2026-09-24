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

/** Parent reporter display name (for PR reviews “Reported by”). */
function mapReporterName(fields){
  const r = fields && fields.reporter;
  if(!r) return null;
  const name = r.displayName || r.name || null;
  return name ? String(name) : null;
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
        'Connected to Jira, but project ' + SOLO_PROJECT_KEY + ' is not visible on this API route. ' +
        'Scoped tokens often need JIRA_CLOUD_ID (Platform gateway) — check /api/health: if route is site or usingCloudId is false, ' +
        'add JIRA_CLOUD_ID from your home .env and restart. If gateway is already on, the token may lack access to ' +
        SOLO_PROJECT_KEY + '.'
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
    dueDate: datePrefix(f.duedate),
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
    reporterName: mapReporterName(f),
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
    assigneeIsCurrentUser: assignee.assigneeIsCurrentUser,
    createdDate: datePrefix(f.created),
    dueDate: datePrefix(f.duedate),
    partner: partnerValue(f, ids.partnerField),
    priority: mapPriority(f),
    hasRa: false,
    hasSubtasks: false,
    handoffDate: null,
    handoffSource: null
  };
}

/**
 * Find earliest WDW-* → CONTENT-* Key change in a changelog page list.
 * Returns { date: 'YYYY-MM-DD', source: 'key-change' } or null.
 */
function handoffFromChangelogHistories(histories){
  if(!Array.isArray(histories) || !histories.length) return null;
  let best = null;
  for(const h of histories){
    const items = (h && h.items) || [];
    for(const item of items){
      if(!item) continue;
      const field = String(item.field || item.fieldId || '').toLowerCase();
      if(field !== 'key' && field !== 'issuekey') continue;
      const fromKey = String(item.fromString || item.from || '').trim().toUpperCase();
      const toKey = String(item.toString || item.to || '').trim().toUpperCase();
      if(!fromKey.startsWith('WDW-') || !toKey.startsWith('CONTENT-')) continue;
      const day = datePrefix(h.created);
      if(!day) continue;
      if(!best || day < best.date) best = { date: day, source: 'key-change' };
    }
  }
  return best;
}

/** Paginate GET /rest/api/3/issue/{key}/changelog for one CONTENT parent. */
async function fetchIssueChangelogHistories(issueKey){
  const histories = [];
  let startAt = 0;
  const maxResults = 100;
  for(let page = 0; page < 20; page++){
    const path = '/rest/api/3/issue/' + encodeURIComponent(issueKey) +
      '/changelog?startAt=' + startAt + '&maxResults=' + maxResults;
    const data = await jiraFetch(path);
    const chunk = (data && data.values) || [];
    histories.push.apply(histories, chunk);
    const total = (data && typeof data.total === 'number') ? data.total : histories.length;
    startAt += chunk.length;
    if(!chunk.length || startAt >= total) break;
  }
  return histories;
}

/**
 * Resolve MS handoff dates for CONTENT parents via changelog Key change.
 * Fallback (caller): CONTENT created date when no WDW→CONTENT Key change found.
 */
async function fetchContentHandoffByKeys(keys){
  const byKey = {};
  if(!keys || !keys.length) return byKey;
  const unique = Array.from(new Set(keys.filter(Boolean)));
  const concurrency = 6;
  for(let i = 0; i < unique.length; i += concurrency){
    const chunk = unique.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (key) => {
      try{
        const histories = await fetchIssueChangelogHistories(key);
        const hit = handoffFromChangelogHistories(histories);
        if(hit) byKey[key] = hit;
      } catch(err){
        console.warn('[jira] CONTENT handoff changelog failed for', key + ':', err.message || err);
      }
    }));
  }
  return byKey;
}

/**
 * CONTENT parents assigned to currentUser with an RA subtask → Solo inject candidates.
 * Portfolio table (reporter OR assignee) stays separate via fetchContentTickets.
 */
async function fetchMsSoloTickets(currentAccountId, fieldIds){
  const jql =
    'project = CONTENT AND assignee = currentUser() AND issuetype != Sub-task AND statusCategory != Done ORDER BY duedate ASC';
  const parentFields = [
    'summary', 'priority', 'duedate', 'created', 'status', 'description',
    fieldIds.publishEarlyField || DEFAULT_PUBLISH_EARLY_FIELD,
    fieldIds.partnerField || DEFAULT_PARTNER_FIELD,
    'assignee', 'reporter'
  ];
  try{
    const issues = await jiraSearch(jql, parentFields, 50);
    if(!issues.length) return { jql, tickets: [] };

    const keys = issues.map(i => i.key);
    const [subsByParent, commentsResult] = await Promise.all([
      fetchSubtasksForParents(keys, currentAccountId, true),
      fetchCommentsForParents(keys)
    ]);
    const commentSignalsByKey = (commentsResult && commentsResult.byKey) || {};

    const tickets = issues.map(i => {
      const mapped = mapActiveTicket(i, subsByParent, currentAccountId, fieldIds, commentSignalsByKey);
      mapped.managedServices = true;
      mapped.scoringProfile = 'ms';
      return mapped;
    }).filter(t => {
      // Gate: RA must exist (MS created RA and assigned parent back).
      return (t.subtasks || []).some(st => st && st.type === 'RA');
    });

    return {
      jql,
      tickets,
      commentsWarning: (commentsResult && commentsResult.error) || null
    };
  } catch(err){
    console.warn('[jira] MS Solo CONTENT fetch failed:', err.message || err);
    return { jql, tickets: [], error: err.message || String(err) };
  }
}

async function fetchContentTickets(currentAccountId, fieldIds){
  const jql = (fieldIds && fieldIds.contentJql) || DEFAULT_CONTENT_JQL;
  const fields = [
    'summary', 'status', 'assignee', 'duedate', 'created', 'priority',
    fieldIds.partnerField || DEFAULT_PARTNER_FIELD
  ];
  try{
    const issues = await jiraSearch(jql, fields, 50);
    const keys = issues.map(i => i.key);
    let raByParent = {};
    let subPresenceByParent = {};
    let handoffByKey = {};
    let subsByParent = {};
    if(keys.length){
      try{
        // Subtask / RA presence for Progress chips + soft red-flag gate (no RA description).
        subsByParent = await fetchSubtasksForParents(keys, currentAccountId, false);
        Object.keys(subsByParent).forEach(pk => {
          const list = subsByParent[pk] || [];
          subPresenceByParent[pk] = list.length > 0;
          raByParent[pk] = list.some(st => st && st.type === 'RA');
        });
      } catch(subErr){
        console.warn('[jira] CONTENT subtask probe failed:', subErr.message || subErr);
      }
      try{
        // Prefer WDW-* → CONTENT-* Key change timestamp for soft check-in clock.
        handoffByKey = await fetchContentHandoffByKeys(keys);
      } catch(handErr){
        console.warn('[jira] CONTENT handoff changelog fetch failed:', handErr.message || handErr);
      }
    }
    return {
      jql,
      tickets: issues.map(i => {
        const mapped = mapContentTicket(i, currentAccountId, fieldIds);
        mapped.subtasks = subsByParent[i.key] || [];
        mapped.hasRa = !!raByParent[i.key];
        mapped.hasSubtasks = !!subPresenceByParent[i.key];
        const handoff = handoffByKey[i.key];
        if(handoff && handoff.date){
          mapped.handoffDate = handoff.date;
          mapped.handoffSource = handoff.source || 'key-change';
        } else if(mapped.createdDate){
          // Documented fallback when Key change not found in changelog.
          mapped.handoffDate = mapped.createdDate;
          mapped.handoffSource = 'created-fallback';
        }
        return mapped;
      })
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
    const fields = ['summary','status','assignee','created','duedate','resolutiondate','description','parent'];
    const issues = await jiraSearch(jql, fields, 200);
    all.push(...issues);
  }
  return groupByParent(all, currentAccountId, includeRaDescription);
}

/**
 * Open subtasks assigned to currentUser → parents for In Focus quick-review lane.
 * Covers PR plus any stage (RA, Copy, Media, …) on WDW/CONTENT when parent is missing
 * from active/msSolo. Returns review subtask keys so callers can force assigneeIsCurrentUser.
 */
async function fetchPrReviewTickets(currentAccountId, fieldIds, knownParentKeys){
  const jql =
    '(project = WDW OR project = CONTENT) AND assignee = currentUser() AND issuetype = Sub-task AND statusCategory != Done ORDER BY created ASC';
  const known = knownParentKeys instanceof Set
    ? knownParentKeys
    : new Set(knownParentKeys || []);
  try{
    const subIssues = await jiraSearch(
      jql,
      ['summary', 'status', 'assignee', 'created', 'duedate', 'resolutiondate', 'parent'],
      50
    );
    const reviewMine = subIssues || [];
    if(!reviewMine.length){
      return { jql, tickets: [], prSubtaskKeys: [] };
    }

    const prSubtaskKeys = reviewMine.map(i => i.key).filter(Boolean);
    const missingParentKeys = [];
    const seenParent = new Set();
    reviewMine.forEach(issue => {
      const pk = issue.fields && issue.fields.parent && issue.fields.parent.key;
      if(!pk || seenParent.has(pk)) return;
      seenParent.add(pk);
      if(!known.has(pk)) missingParentKeys.push(pk);
    });

    if(!missingParentKeys.length){
      return { jql, tickets: [], prSubtaskKeys };
    }

    const parentFields = [
      'summary', 'priority', 'duedate', 'created', 'status', 'description',
      fieldIds.publishEarlyField || DEFAULT_PUBLISH_EARLY_FIELD,
      fieldIds.partnerField || DEFAULT_PARTNER_FIELD,
      'assignee', 'reporter'
    ];
    const parentIssues = await jiraSearch(
      'key in (' + missingParentKeys.join(',') + ')',
      parentFields,
      missingParentKeys.length
    );
    if(!parentIssues.length){
      return { jql, tickets: [], prSubtaskKeys };
    }

    const keys = parentIssues.map(i => i.key);
    const prKeySet = new Set(prSubtaskKeys);
    const [subsByParent, commentsResult] = await Promise.all([
      fetchSubtasksForParents(keys, currentAccountId, true),
      fetchCommentsForParents(keys)
    ]);
    Object.keys(subsByParent).forEach(pk => {
      (subsByParent[pk] || []).forEach(st => {
        if(st && prKeySet.has(st.key)) st.assigneeIsCurrentUser = true;
      });
    });

    const commentSignalsByKey = (commentsResult && commentsResult.byKey) || {};
    const tickets = parentIssues.map(i => {
      const mapped = mapActiveTicket(i, subsByParent, currentAccountId, fieldIds, commentSignalsByKey);
      if(String(i.key || '').toUpperCase().startsWith('CONTENT-')){
        mapped.managedServices = true;
        mapped.scoringProfile = 'ms';
      }
      return mapped;
    });

    return {
      jql,
      tickets,
      prSubtaskKeys,
      commentsWarning: (commentsResult && commentsResult.error) || null
    };
  } catch(err){
    console.warn('[jira] Quick-review parent fetch failed:', err.message || err);
    return { jql, tickets: [], prSubtaskKeys: [], error: err.message || String(err) };
  }
}

/** How many newest comments to scan per parent for Waiting / Partner signals. */
const COMMENT_SCAN_MAX = 25;

/** Newest comment wins; "clear" beats stale block language in older comments. */
function commentLineIsClear(low){
  return /(?:no\s+longer\s+blocked|unblocked|cleared|clear\s+to\s+(?:publish|release|go))/.test(low)
    || /(?:ready\s+(?:for\s+)?(?:release|publish|go\s+live|media)|good\s+to\s+go)/.test(low)
    || /(?:resolved|all\s+set|we(?:'re|\s+are)\s+good)/.test(low)
    || /(?:approved|merged|no\s+action\s+needed|nothing\s+blocking)/.test(low)
    || /(?:blocker\s+)?(?:removed|lifted)/.test(low)
    || /(?:images?|assets?|photos?)\s+(?:received|uploaded|added|in\s+jira|attached)/.test(low)
    || /(?:received|got|have)\s+(?:the\s+)?(?:images?|assets?|photos?)/.test(low)
    || /no\s+longer\s+waiting\s+(?:for|on)\s+(?:images?|assets?|photos?|partner)/.test(low)
    || /(?:partner|dakota)\s+(?:sent|provided|delivered|uploaded)/.test(low);
}

function commentLineIsBlock(low){
  const waitingOnImages = /waiting\s+(?:for|on)\s+(?:the\s+)?(?:images?|assets?|photos?)/.test(low)
    || /(?:need(?:s|ed)?|awaiting)\s+(?:images?|assets?|photos?)\s+(?:from|before)/.test(low)
    || /(?:images?|assets?|photos?)\s+from\s+(?:partner|dakota)/.test(low)
    || /from\s+partner\s+(?:before|for)\b/.test(low)
    || /(?:have|get|need)\s+(?:photos?|images?|assets?)\s+sent/.test(low)
    || /once\s+(?:the\s+)?(?:images?|photos?|assets?)\s+(?:are\s+)?added/.test(low)
    || /(?:note|ask(?:ing)?|asked)\s+to\s+partner.*(?:photos?|images?|assets?)/.test(low)
    || /partner.*(?:photos?|images?|assets?).*(?:sent|add|deliver)/.test(low)
    || /(?:photos?|images?|assets?).*(?:from|to)\s+partner/.test(low)
    || (/sent\s+note\s+to\s+partner/.test(low) && /(?:photos?|images?|assets?)/.test(low));

  const dateAdjusted = /(?:due|date)\s+(?:was\s+)?(?:adjusted|pushed|moved|changed|shifted)/.test(low)
    || /(?:adjusted|pushed|moved|changed|shifted)\s+(?:the\s+)?(?:due\s+)?date/.test(low)
    || /date\s+(?:adjustment|change|push)/.test(low);

  const releaseBlock = /blocked\s+(?:on|by)\b/.test(low)
    || /holding\s+(?:for|on)\s+(?:release|publish)/.test(low)
    || /(?:can(?:'|no)?t|cannot)\s+publish/.test(low)
    || /waiting\s+(?:for|on)\s+.*(?:before|until)\s+(?:release|publish)/.test(low)
    || /(?:release|publish)\s+(?:blocked|on\s+hold)/.test(low);

  const generalWait = /waiting\s+(?:for|on)\b/.test(low)
    || /holding\s+(?:for|on)\b/.test(low)
    || /still\s+need(?:s|ed)?\b/.test(low);

  if(!waitingOnImages && !dateAdjusted && !releaseBlock && !generalWait) return null;
  return { waitingOnImages, dateAdjusted, releaseBlock };
}

/**
 * Heuristics over recent comments (newest first) for Solo Waiting lane.
 */
function analyzeCommentSignals(commentTexts){
  const empty = {
    waitingOnOthers: false,
    waitingOnImages: false,
    dateAdjusted: false,
    waitingOnPartnerAssets: false,
    matchSnippet: null
  };
  const texts = (commentTexts || []).filter(Boolean);
  if(!texts.length) return empty;

  for(let i = 0; i < texts.length; i++){
    const low = String(texts[i]).toLowerCase();
    if(commentLineIsClear(low)) return empty;
    const block = commentLineIsBlock(low);
    if(block){
      const snippet = String(texts[i]).replace(/\s+/g, ' ').trim().slice(0, 140) || null;
      return {
        waitingOnOthers: true,
        waitingOnImages: block.waitingOnImages,
        dateAdjusted: block.dateAdjusted,
        waitingOnPartnerAssets: block.waitingOnImages,
        matchSnippet: snippet
      };
    }
  }
  return empty;
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
    'resolutiondate','assignee','reporter'
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

  const [activeSubs, closedSubs, contentResult, commentsResult, msSoloResult] = await Promise.all([
    fetchSubtasksForParents(activeKeys, currentAccountId, true),
    fetchSubtasksForParents(closedKeys, currentAccountId, false),
    fetchContentTickets(currentAccountId, fieldIds),
    fetchCommentsForParents(activeKeys),
    fetchMsSoloTickets(currentAccountId, fieldIds)
  ]);

  const knownParentKeys = new Set(activeKeys);
  ((msSoloResult && msSoloResult.tickets) || []).forEach(t => {
    if(t && t.key) knownParentKeys.add(t.key);
  });
  const prReviewResult = await fetchPrReviewTickets(currentAccountId, fieldIds, knownParentKeys);

  const commentSignalsByKey = (commentsResult && commentsResult.byKey) || {};
  const commentsWarning = (commentsResult && commentsResult.error)
    || (msSoloResult && msSoloResult.commentsWarning)
    || (prReviewResult && prReviewResult.commentsWarning)
    || null;

  return {
    currentUserFirstName,
    activeTickets: activeIssues.map(i => mapActiveTicket(i, activeSubs, currentAccountId, fieldIds, commentSignalsByKey)),
    recentlyClosedTickets: closedIssues.map(i => mapClosedTicket(i, closedSubs, currentAccountId)),
    contentTickets: contentResult.tickets || [],
    contentJql: contentResult.jql || DEFAULT_CONTENT_JQL,
    msSoloTickets: (msSoloResult && msSoloResult.tickets) || [],
    // Parents with an open PR assigned to me that active/msSolo did not already cover.
    prReviewTickets: (prReviewResult && prReviewResult.tickets) || [],
    // All open PR subtask keys assigned to me (incl. parents already on the board).
    prSubtaskKeys: (prReviewResult && prReviewResult.prSubtaskKeys) || [],
    commentsWarning
  };
}

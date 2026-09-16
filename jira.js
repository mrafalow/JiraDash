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
  const params = new URLSearchParams({
    jql,
    fields: fields.join(','),
    maxResults: String(maxResults || 50)
  });
  const data = await jiraFetch('/rest/api/3/search?' + params.toString());
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

function publishEarlyValue(fields){
  const raw = fields.customfield_10182;
  if(raw == null) return null;
  if(typeof raw === 'string') return raw;
  if(typeof raw === 'object' && raw.value != null) return String(raw.value);
  return null;
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

function mapActiveTicket(issue, subtasksByParent, currentAccountId){
  const f = issue.fields || {};
  const subtasks = (subtasksByParent[issue.key] || []).slice();
  const ticketDesc = descriptionToText(f.description);
  const ra = subtasks.find(s => s.type === 'RA');
  const override = doNotPublishEarlyFromText(ticketDesc) || doNotPublishEarlyFromText(ra && ra.description);
  return {
    key: issue.key,
    summary: f.summary || '',
    priority: mapPriority(f),
    createdDate: datePrefix(f.created),
    dueDate: datePrefix(f.duedate),
    publishEarlyField: publishEarlyValue(f),
    doNotPublishEarlyOverride: !!override,
    subtasks
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

/**
 * Fetch board-shaped payload matching Studio Titan expectations.
 * Credentials never leave the local proxy (see server.js).
 */
async function fetchJiraData(){
  // Probe config / auth early for a clear error
  let me;
  try{
    me = await jiraFetch('/rest/api/3/myself');
  } catch(err){
    if(err.status === 401 || err.status === 403){
      throw new Error('Jira rejected the credentials in .env (check JIRA_EMAIL and JIRA_API_TOKEN).');
    }
    if(err.status === 503 || /not configured|missing/i.test(err.message)){
      throw new Error(err.message || 'Jira credentials missing. Set JIRA_EMAIL and JIRA_API_TOKEN in .env.');
    }
    throw err;
  }

  const currentAccountId = me.accountId;
  const displayName = me.displayName || '';
  const currentUserFirstName = displayName.split(/\s+/)[0] || displayName || null;

  const parentFields = ['summary','priority','duedate','created','status','description','customfield_10182','resolutiondate'];

  const activeIssues = await jiraSearch(
    'project = WDW AND (assignee = currentUser() OR reporter = currentUser()) AND issuetype != Sub-task AND status != Closed ORDER BY duedate ASC',
    parentFields,
    50
  );

  const closedIssues = await jiraSearch(
    'project = WDW AND (assignee = currentUser() OR reporter = currentUser()) AND issuetype != Sub-task AND status = Closed ORDER BY resolutiondate DESC',
    parentFields,
    15
  );

  const activeKeys = activeIssues.map(i => i.key);
  const closedKeys = closedIssues.map(i => i.key);

  const [activeSubs, closedSubs] = await Promise.all([
    fetchSubtasksForParents(activeKeys, currentAccountId, true),
    fetchSubtasksForParents(closedKeys, currentAccountId, false)
  ]);

  return {
    currentUserFirstName,
    activeTickets: activeIssues.map(i => mapActiveTicket(i, activeSubs, currentAccountId)),
    recentlyClosedTickets: closedIssues.map(i => mapClosedTicket(i, closedSubs, currentAccountId))
  };
}

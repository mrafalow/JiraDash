'use strict';

const https = require('https');

const API_BASE = 'api.smartsheet.com';
const CACHE_TTL_MS = Number(process.env.SMARTSHEET_CACHE_TTL_MS || 90000);
const cache = new Map();

function getAccessToken() {
  return (process.env.SMARTSHEET_ACCESS_TOKEN || '').trim();
}

function sheetIdFromRunbookUrl(url) {
  const m = String(url || '').match(/\/sheets\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function normalizeHeader(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function columnFieldMap(columns) {
  const byId = {};
  const pick = (col, patterns) => {
    const h = normalizeHeader(col.title);
    for (const p of patterns) {
      if (p.test(h)) return true;
    }
    return false;
  };
  (columns || []).forEach((col) => {
    if (pick(col, [/^task name$/, /^task$/, /^name$/])) byId.taskName = col.id;
    else if (pick(col, [/^status$/])) byId.status = col.id;
    else if (pick(col, [/^team$/])) byId.team = col.id;
    else if (pick(col, [/^owner$/])) byId.owner = col.id;
    else if (pick(col, [/^comments$/])) byId.comments = col.id;
    else if (pick(col, [/^start date$/])) byId.startDate = col.id;
    else if (pick(col, [/^due date/, /^date of action/])) byId.dueDate = col.id;
    else if (pick(col, [/^workstream$/])) byId.workstream = col.id;
  });
  return byId;
}

function cellValue(row, columnId) {
  if (!columnId || !row || !row.cells) return '';
  const cell = row.cells.find((c) => c.columnId === columnId);
  if (!cell) return '';
  const v = cell.displayValue != null ? cell.displayValue : cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v.objectType === 'DATE') {
    return v.toString ? String(v) : '';
  }
  return String(v).trim();
}

function isNotApplicableStatus(status) {
  const s = normalizeHeader(status);
  return s === 'not applicable' || s === 'n/a' || s === 'na';
}

function httpsGetJson(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_BASE,
        path,
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json'
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = body ? JSON.parse(body) : null;
          } catch (e) {
            reject(new Error('Smartsheet returned non-JSON (HTTP ' + res.statusCode + ').'));
            return;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }
          const msg =
            (parsed && parsed.message) ||
            (parsed && parsed.errorMessage) ||
            'Smartsheet HTTP ' + res.statusCode;
          const err = new Error(msg);
          err.statusCode = res.statusCode;
          reject(err);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(45000, () => {
      req.destroy(new Error('Smartsheet request timed out.'));
    });
    req.end();
  });
}

function buildRowIndex(rows) {
  const byId = {};
  (rows || []).forEach((r) => {
    byId[r.id] = r;
  });
  return byId;
}

function sectionPathForRow(row, byId, fields, depthLimit) {
  const parts = [];
  let cur = row;
  let depth = 0;
  while (cur && cur.parentId && depth < (depthLimit || 8)) {
    const parent = byId[cur.parentId];
    if (!parent) break;
    const label =
      cellValue(parent, fields.taskName) ||
      cellValue(parent, fields.workstream) ||
      cellValue(parent, fields.team);
    if (label) parts.unshift(label);
    cur = parent;
    depth++;
  }
  return parts.join(' › ');
}

function parseSheetRows(sheet) {
  const fields = columnFieldMap(sheet.columns);
  const rows = sheet.rows || [];
  const byId = buildRowIndex(rows);
  const tasks = [];

  rows.forEach((row, index) => {
    const taskName = cellValue(row, fields.taskName);
    const status = cellValue(row, fields.status);
    const team = cellValue(row, fields.team);
    const owner = cellValue(row, fields.owner);
    const comments = cellValue(row, fields.comments);
    const startDate = cellValue(row, fields.startDate);
    const dueDate = cellValue(row, fields.dueDate);
    const workstream = cellValue(row, fields.workstream);
    const section = sectionPathForRow(row, byId, fields);

    const isHeader =
      !taskName &&
      (!!status || !!startDate || !!dueDate || !!workstream) &&
      !team;

    if (!taskName && !isHeader) return;

    tasks.push({
      rowId: row.id,
      rowNumber: row.rowNumber != null ? row.rowNumber : index + 1,
      indent: row.indent != null ? row.indent : 0,
      section,
      workstream,
      team,
      taskName: taskName || (isHeader ? section || workstream || '—' : ''),
      isSectionHeader: isHeader,
      status,
      startDate,
      dueDate,
      owner,
      comments,
      notApplicable: isNotApplicableStatus(status)
    });
  });

  return tasks;
}

async function fetchSheetById(sheetId, token) {
  const path = '/2.0/sheets/' + encodeURIComponent(sheetId) + '?include=objectValue';
  return httpsGetJson(path, token);
}

/**
 * @param {{ epicKey: string, runbookConfig: object, includeNotApplicable?: boolean, refresh?: boolean }}
 */
async function fetchLiveRunbookForEpic(options) {
  const token = getAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        'SMARTSHEET_ACCESS_TOKEN is not set in .env. Create a Personal Access Token in Smartsheet (Account → Apps & Integrations → API Access).'
    };
  }

  const cfg = options.runbookConfig || {};
  const sheetId =
    cfg.smartsheetSheetId || sheetIdFromRunbookUrl(cfg.runbookUrl) || null;
  if (!sheetId) {
    return { ok: false, error: 'No Smartsheet sheet id (set smartsheetSheetId or runbookUrl in launch-runbooks.json).' };
  }

  const cacheKey = options.epicKey + ':' + sheetId;
  const refresh = !!options.refresh;
  if (!refresh && cache.has(cacheKey)) {
    const hit = cache.get(cacheKey);
    if (Date.now() - hit.at < CACHE_TTL_MS) {
      return filterTasksResponse(hit.payload, options.includeNotApplicable);
    }
  }

  let sheet;
  try {
    sheet = await fetchSheetById(sheetId, token);
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      statusCode: err.statusCode
    };
  }

  const payload = {
    ok: true,
    epicKey: options.epicKey,
    sheetId,
    sheetName: sheet.name || '',
    fetchedAt: new Date().toISOString(),
    permalink: sheet.permalink || cfg.runbookUrl || null,
    tasks: parseSheetRows(sheet)
  };
  cache.set(cacheKey, { at: Date.now(), payload });
  return filterTasksResponse(payload, options.includeNotApplicable);
}

function filterTasksResponse(payload, includeNotApplicable) {
  if (!payload.ok) return payload;
  const include = !!includeNotApplicable;
  const tasks = include
    ? payload.tasks
    : (payload.tasks || []).filter((t) => !t.notApplicable);
  return Object.assign({}, payload, {
    tasks,
    taskCount: tasks.length,
    hiddenNotApplicable: include
      ? 0
      : (payload.tasks || []).filter((t) => t.notApplicable).length
  });
}

module.exports = {
  getAccessToken,
  sheetIdFromRunbookUrl,
  fetchLiveRunbookForEpic,
  isNotApplicableStatus,
  parseSheetRows
};

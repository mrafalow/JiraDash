#!/usr/bin/env node
/**
 * Tiny local server: serves static dashboard files and proxies Jira Cloud
 * with Basic Auth from .env (never exposed to the browser).
 *
 * Env (repo-root .env — gitignored):
 *   JIRA_BASE_URL=https://your-site.atlassian.net/
 *   JIRA_EMAIL=you@example.com
 *   JIRA_API_TOKEN=...
 * Optional for scoped API tokens:
 *   JIRA_CLOUD_ID=<cloud id>
 * Optional CONTENT delivery JQL override (Step 6):
 *   JIRA_CONTENT_JQL=project = CONTENT AND ...
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3847);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

function trimSlash(s){ return String(s || '').replace(/\/+$/, ''); }

/** Cached cloudId resolved from site tenant_info (scoped API tokens need the gateway). */
let resolvedCloudId = null;
let resolvingCloudId = null;
/** After first successful call: 'gateway' | 'site'. Gateway 401 → retry site (corp network). */
let jiraRoute = null;

const PROBE_PROJECT = (process.env.JIRA_PROJECT_KEY || 'WDW').trim() || 'WDW';

function fakeGetReq(){
  return { method: 'GET', headers: {} };
}

function probeProjectAccess(cfg, useGateway){
  const fakeReq = fakeGetReq();
  return jiraUpstreamRequest(
    cfg,
    useGateway,
    fakeReq,
    '/rest/api/3/project/' + encodeURIComponent(PROBE_PROJECT),
    null
  );
}

function resolveJiraRoute(cfg){
  if(useSiteApiOnly()){
    jiraRoute = 'site';
    return Promise.resolve('site');
  }
  if(!cfg.cloudId || !wantsScopedGateway()){
    jiraRoute = 'site';
    return Promise.resolve('site');
  }
  return probeProjectAccess(cfg, true).then((gwProbe) => {
    if(gwProbe.status === 200){
      jiraRoute = 'gateway';
      return 'gateway';
    }
    return probeProjectAccess(cfg, false).then((siteProbe) => {
      if(siteProbe.status === 200){
        jiraRoute = 'site';
        console.log('NOTE: Platform gateway returned HTTP ' + gwProbe.status +
          '; site URL can see project ' + PROBE_PROJECT + ' — using site for this session.');
        return 'site';
      }
      jiraRoute = 'gateway';
      console.log('WARNING: API token cannot reach project ' + PROBE_PROJECT +
        ' (gateway HTTP ' + gwProbe.status + ', site HTTP ' + siteProbe.status + '). ' +
        'Use the same JIRA_API_TOKEN as home with JIRA_CLOUD_ID, or update token scopes.');
      return 'gateway';
    });
  });
}

function getJiraConfig(){
  const email = (process.env.JIRA_EMAIL || '').trim();
  const token = (process.env.JIRA_API_TOKEN || '').trim();
  const baseUrl = trimSlash(process.env.JIRA_BASE_URL || '');
  const cloudId = (process.env.JIRA_CLOUD_ID || '').trim() || resolvedCloudId || '';
  const missing = [];
  if(!email) missing.push('JIRA_EMAIL');
  if(!token) missing.push('JIRA_API_TOKEN');
  if(!baseUrl && !cloudId) missing.push('JIRA_BASE_URL (or JIRA_CLOUD_ID)');
  return { email, token, baseUrl, cloudId, missing };
}

function jiraOriginFor(cfg, useGateway){
  if(useGateway && cfg.cloudId){
    return 'https://api.atlassian.com/ex/jira/' + encodeURIComponent(cfg.cloudId);
  }
  return cfg.baseUrl;
}

/**
 * Resolve cloudId from https://{site}/_edge/tenant_info when JIRA_CLOUD_ID is unset.
 * (oauth/token/accessible-resources is for OAuth Bearer tokens, not Basic API tokens.)
 */
function resolveCloudIdFromTenantInfo(baseUrl){
  if(!baseUrl) return Promise.resolve(null);
  if(resolvedCloudId) return Promise.resolve(resolvedCloudId);
  if(resolvingCloudId) return resolvingCloudId;
  resolvingCloudId = new Promise((resolve) => {
    try{
      const target = new URL('/_edge/tenant_info', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
      const lib = target.protocol === 'http:' ? http : https;
      const req = lib.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname,
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'StudioTitanLocal/1.0' }
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolvingCloudId = null;
          if((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300){
            resolve(null);
            return;
          }
          try{
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const id = (data && (data.cloudId || data.cloudid || data.id)) || null;
            if(id) resolvedCloudId = String(id).trim();
            resolve(resolvedCloudId);
          } catch(_){
            resolve(null);
          }
        });
      });
      req.on('error', () => { resolvingCloudId = null; resolve(null); });
      req.setTimeout(8000, () => { req.destroy(); resolvingCloudId = null; resolve(null); });
      req.end();
    } catch(_){
      resolvingCloudId = null;
      resolve(null);
    }
  });
  return resolvingCloudId;
}

/** Use api.atlassian.com/ex/jira/{cloudId} only when explicitly requested. */
function wantsScopedGateway(){
  if(process.env.JIRA_USE_SITE_API === '1' || process.env.JIRA_USE_SITE_API === 'true') return false;
  if(process.env.JIRA_USE_SCOPED_GATEWAY === '1' || process.env.JIRA_USE_SCOPED_GATEWAY === 'true') return true;
  const explicit = (process.env.JIRA_CLOUD_ID || '').trim();
  return !!explicit;
}

function ensureCloudId(cfg){
  if(!wantsScopedGateway()) return Promise.resolve(cfg);
  if(cfg.cloudId) return Promise.resolve(cfg);
  if(!cfg.baseUrl) return Promise.resolve(cfg);
  return resolveCloudIdFromTenantInfo(cfg.baseUrl).then((id) => {
    if(id) cfg.cloudId = id;
    return cfg;
  });
}

function sendJson(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveStatic(req, res, pathname){
  let rel = pathname === '/' ? '/studio-titan.html' : pathname;
  rel = decodeURIComponent(rel).split('?')[0];
  if(rel.includes('..')){
    res.writeHead(400); res.end('Bad path'); return;
  }
  const filePath = path.join(ROOT, rel);
  if(!filePath.startsWith(ROOT)){
    res.writeHead(400); res.end('Bad path'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if(err){
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function jiraOriginFor(cfg, useGateway){
  if(useGateway && cfg.cloudId){
    return 'https://api.atlassian.com/ex/jira/' + encodeURIComponent(cfg.cloudId);
  }
  return cfg.baseUrl;
}

function useSiteApiOnly(){
  return process.env.JIRA_USE_SITE_API === '1' || process.env.JIRA_USE_SITE_API === 'true';
}

function shouldTryGatewayFirst(cfg){
  if(useSiteApiOnly()) return false;
  if(!cfg.cloudId) return false;
  if(jiraRoute === 'site') return false;
  if(jiraRoute === 'gateway') return true;
  return wantsScopedGateway();
}

function readRequestBody(req){
  return new Promise((resolve, reject) => {
    if(req.method === 'GET' || req.method === 'HEAD') return resolve(null);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
  });
}

function jiraUpstreamRequest(cfg, useGateway, req, pathAndQuery, bodyBuf){
  const origin = trimSlash(jiraOriginFor(cfg, useGateway));
  const pathAndQueryNorm = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;
  let target;
  try{
    target = new URL(origin + pathAndQueryNorm);
  } catch(_){
    return Promise.reject(new Error('Invalid JIRA_BASE_URL / JIRA_CLOUD_ID'));
  }
  if(!target.hostname){
    return Promise.reject(new Error('Invalid JIRA_BASE_URL / JIRA_CLOUD_ID'));
  }

  const auth = Buffer.from(cfg.email + ':' + cfg.token).toString('base64');
  const lib = target.protocol === 'http:' ? http : https;
  const headers = {
    Authorization: 'Basic ' + auth,
    Accept: 'application/json',
    'User-Agent': 'StudioTitanLocal/1.0'
  };
  if(req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if(bodyBuf && bodyBuf.length) headers['Content-Length'] = String(bodyBuf.length);

  return new Promise((resolve, reject) => {
    const upstream = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers
    }, (up) => {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        resolve({
          status: up.statusCode || 502,
          contentType: up.headers['content-type'] || 'application/json; charset=utf-8',
          buf: Buffer.concat(chunks),
          viaGateway: !!(useGateway && cfg.cloudId)
        });
      });
    });
    upstream.on('error', reject);
    if(bodyBuf && bodyBuf.length) upstream.write(bodyBuf);
    upstream.end();
  });
}

function sendJiraProxyResponse(res, cfg, result){
  let buf = result.buf;
  let status = result.status;
  let contentType = result.contentType;
  if(status === 401 || status === 403){
    let upstreamMsg = '';
    try{
      const parsed = JSON.parse(buf.toString('utf8'));
      upstreamMsg = (parsed && (parsed.message || (parsed.errorMessages && parsed.errorMessages.join('; ')))) || '';
    } catch(_){}
    contentType = 'application/json; charset=utf-8';
    buf = Buffer.from(JSON.stringify({
      message: upstreamMsg && /scope/i.test(upstreamMsg)
        ? ('Jira rejected this call due to token scopes: ' + upstreamMsg + ' (scoped tokens need api.atlassian.com + JIRA_CLOUD_ID; /myself needs read:jira-user).')
        : (result.viaGateway && (status === 401 || status === 403)
          ? 'Jira Platform gateway rejected this token (HTTP ' + status + '). ' +
            'Use the same JIRA_API_TOKEN as your home setup with JIRA_CLOUD_ID, or create a token with Jira API access to project ' + PROBE_PROJECT + '.'
          : 'Jira rejected the credentials in .env (check JIRA_EMAIL, JIRA_API_TOKEN, and for scoped tokens JIRA_CLOUD_ID / api.atlassian.com).'),
      status,
      usingCloudId: result.viaGateway,
      route: result.viaGateway ? 'gateway' : 'site'
    }));
  }
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(buf);
}

function proxyJira(req, res, apiPathWithQuery){
  const cfg0 = getJiraConfig();
  if(cfg0.missing.length){
    sendJson(res, 503, {
      message: 'Jira credentials missing. Set ' + cfg0.missing.join(', ') + ' in .env (never commit this file).',
      missing: cfg0.missing
    });
    return;
  }

  ensureCloudId(cfg0).then((cfg) => {
    return readRequestBody(req).then((bodyBuf) => {
      const tryGateway = shouldTryGatewayFirst(cfg);
      return jiraUpstreamRequest(cfg, tryGateway, req, apiPathWithQuery, bodyBuf).then((result) => {
        const authFail = result.status === 401 || result.status === 403;
        if(authFail && tryGateway && cfg.baseUrl && !useSiteApiOnly()){
          return probeProjectAccess(cfg, false).then((siteProbe) => {
            if(siteProbe.status !== 200){
              return result;
            }
            return jiraUpstreamRequest(cfg, false, req, apiPathWithQuery, bodyBuf).then((siteResult) => {
              jiraRoute = 'site';
              if(siteResult.status >= 200 && siteResult.status < 300){
                console.log('NOTE: Jira gateway returned ' + result.status +
                  '; site URL can see ' + PROBE_PROJECT + ' — using site for this session.');
              }
              return siteResult;
            });
          });
        }
        if(result.status >= 200 && result.status < 300){
          jiraRoute = tryGateway ? 'gateway' : 'site';
        }
        return result;
      });
    });
  }).then((result) => {
    sendJiraProxyResponse(res, cfg0, result);
  }).catch((err) => {
    sendJson(res, 502, { message: 'Upstream Jira request failed: ' + err.message });
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = u.pathname;

  if(pathname === '/api/health'){
    const cfg0 = getJiraConfig();
    ensureCloudId(cfg0).then((cfg) => {
      sendJson(res, 200, {
        ok: true,
        jiraConfigured: cfg.missing.length === 0,
        missing: cfg.missing,
        usingCloudId: !!cfg.cloudId,
        route: jiraRoute || (cfg.cloudId && !useSiteApiOnly() ? 'gateway (initial)' : 'site'),
        site: cfg.cloudId ? ('api.atlassian.com/ex/jira/' + cfg.cloudId) : cfg.baseUrl
      });
    });
    return;
  }

  // Non-secret field IDs / JQL overrides (secrets stay in .env only).
  if(pathname === '/api/config'){
    sendJson(res, 200, {
      partnerField: (process.env.JIRA_PARTNER_FIELD || '').trim() || 'customfield_10329',
      publishEarlyField: (process.env.JIRA_PUBLISH_EARLY_FIELD || '').trim() || 'customfield_10182',
      // Override CONTENT delivery ownership query without a code change.
      contentJql: (process.env.JIRA_CONTENT_JQL || '').trim() || null
    });
    return;
  }

  if(pathname.startsWith('/api/jira/')){
    const rest = pathname.slice('/api/jira'.length) + u.search;
    proxyJira(req, res, rest);
    return;
  }

  if(pathname.startsWith('/api/')){
    sendJson(res, 404, { message: 'Unknown API route' });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  const cfg0 = getJiraConfig();
  console.log('Studio Titan local server');
  console.log('  Dashboard: http://127.0.0.1:' + PORT + '/');
  console.log('  Health:    http://127.0.0.1:' + PORT + '/api/health');
  if(cfg0.missing.length){
    console.log('  WARNING: missing ' + cfg0.missing.join(', ') + ' in .env');
    return;
  }
  ensureCloudId(cfg0).then((cfg) => {
    return resolveJiraRoute(cfg).then((route) => {
      console.log('  Jira:      configured (route: ' + route +
        (cfg.cloudId ? ', cloudId set' : ', site URL') + ')');
    });
  });
});

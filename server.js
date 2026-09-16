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

function getJiraConfig(){
  const email = (process.env.JIRA_EMAIL || '').trim();
  const token = (process.env.JIRA_API_TOKEN || '').trim();
  const baseUrl = trimSlash(process.env.JIRA_BASE_URL || '');
  const cloudId = (process.env.JIRA_CLOUD_ID || '').trim();
  const missing = [];
  if(!email) missing.push('JIRA_EMAIL');
  if(!token) missing.push('JIRA_API_TOKEN');
  if(!baseUrl && !cloudId) missing.push('JIRA_BASE_URL (or JIRA_CLOUD_ID)');
  return { email, token, baseUrl, cloudId, missing };
}

function jiraApiOrigin(cfg){
  if(cfg.cloudId){
    return 'https://api.atlassian.com/ex/jira/' + encodeURIComponent(cfg.cloudId);
  }
  return cfg.baseUrl;
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

function proxyJira(req, res, apiPathWithQuery){
  const cfg = getJiraConfig();
  if(cfg.missing.length){
    sendJson(res, 503, {
      message: 'Jira credentials missing. Set ' + cfg.missing.join(', ') + ' in .env (never commit this file).',
      missing: cfg.missing
    });
    return;
  }

  const origin = jiraApiOrigin(cfg);
  const target = new URL(apiPathWithQuery.replace(/^\/+/, '/'), origin.endsWith('/') ? origin : origin + '/');
  if(!target.hostname){
    sendJson(res, 500, { message: 'Invalid JIRA_BASE_URL / JIRA_CLOUD_ID' });
    return;
  }

  const auth = Buffer.from(cfg.email + ':' + cfg.token).toString('base64');
  const lib = target.protocol === 'http:' ? http : https;
  const headers = {
    Authorization: 'Basic ' + auth,
    Accept: 'application/json',
    'User-Agent': 'StudioTitanLocal/1.0'
  };
  if(req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

  const upstream = lib.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers
  }, (up) => {
    const chunks = [];
    up.on('data', c => chunks.push(c));
    up.on('end', () => {
      let buf = Buffer.concat(chunks);
      const status = up.statusCode || 502;
      let contentType = up.headers['content-type'] || 'application/json; charset=utf-8';
      // Normalize auth failures so the browser always gets a clear JSON message.
      if(status === 401 || status === 403){
        contentType = 'application/json; charset=utf-8';
        buf = Buffer.from(JSON.stringify({
          message: 'Jira rejected the credentials in .env (check JIRA_EMAIL and JIRA_API_TOKEN).',
          status
        }));
      }
      res.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      });
      res.end(buf);
    });
  });

  upstream.on('error', (err) => {
    sendJson(res, 502, { message: 'Upstream Jira request failed: ' + err.message });
  });

  if(req.method === 'GET' || req.method === 'HEAD'){
    upstream.end();
  } else {
    req.pipe(upstream);
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = u.pathname;

  if(pathname === '/api/health'){
    const cfg = getJiraConfig();
    sendJson(res, 200, {
      ok: true,
      jiraConfigured: cfg.missing.length === 0,
      missing: cfg.missing,
      usingCloudId: !!cfg.cloudId,
      site: cfg.cloudId ? ('api.atlassian.com/ex/jira/' + cfg.cloudId) : cfg.baseUrl
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
  const cfg = getJiraConfig();
  console.log('Studio Titan local server');
  console.log('  Dashboard: http://127.0.0.1:' + PORT + '/');
  console.log('  Health:    http://127.0.0.1:' + PORT + '/api/health');
  if(cfg.missing.length){
    console.log('  WARNING: missing ' + cfg.missing.join(', ') + ' in .env');
  } else {
    console.log('  Jira:      configured' + (cfg.cloudId ? ' (scoped cloudId)' : ' via site URL'));
  }
});

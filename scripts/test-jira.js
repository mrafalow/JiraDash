#!/usr/bin/env node
/**
 * Jira connectivity check (uses .env via the same rules as server.js).
 * Supports classic site tokens and scoped API tokens (api.atlassian.com + cloudId).
 * Run: npm run test:jira
 */
'use strict';

const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function trimSlash(s){ return String(s || '').replace(/\/+$/, ''); }

const email = (process.env.JIRA_EMAIL || '').trim();
const token = (process.env.JIRA_API_TOKEN || '').trim();
const baseUrl = trimSlash(process.env.JIRA_BASE_URL || '');
let cloudId = (process.env.JIRA_CLOUD_ID || '').trim();

if(!email || !token || (!baseUrl && !cloudId)){
  console.error('FAIL: Set JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL (or JIRA_CLOUD_ID) in .env');
  process.exit(1);
}

function requestJson(targetUrl, method, bodyObj){
  return new Promise((resolve, reject) => {
    const target = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;
    const auth = Buffer.from(email + ':' + token).toString('base64');
    const lib = target.protocol === 'http:' ? http : https;
    const headers = {
      Authorization: 'Basic ' + auth,
      Accept: 'application/json',
      'User-Agent': 'StudioTitanLocal/1.0'
    };
    let body = null;
    if(bodyObj != null){
      body = JSON.stringify(bodyObj);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: method || 'GET',
      headers
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let parsed = null;
        try{ parsed = raw ? JSON.parse(raw) : null; } catch(_){ parsed = null; }
        resolve({ status: res.statusCode || 0, raw, json: parsed });
      });
    });
    req.on('error', reject);
    if(body) req.write(body);
    req.end();
  });
}

function fetchTenantCloudId(){
  if(!baseUrl) return Promise.resolve(null);
  const target = new URL('/_edge/tenant_info', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const lib = target.protocol === 'http:' ? http : https;
  return new Promise((resolve) => {
    const req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'StudioTitanLocal/1.0' }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try{
          const data = JSON.parse(raw);
          resolve((data && (data.cloudId || data.cloudid || data.id)) || null);
        } catch(_){
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function originFor(){
  if(process.env.JIRA_USE_SITE_API === '1' || process.env.JIRA_USE_SITE_API === 'true') return baseUrl;
  if(cloudId){
    return 'https://api.atlassian.com/ex/jira/' + encodeURIComponent(cloudId);
  }
  return baseUrl;
}

function urlOnOrigin(pathname){
  const origin = trimSlash(originFor());
  const path = pathname.startsWith('/') ? pathname : '/' + pathname;
  // Avoid new URL('/abs', origin) which strips /ex/jira/{cloudId}.
  return new URL(origin + path);
}

function wantsScopedGateway(){
  if(process.env.JIRA_USE_SITE_API === '1' || process.env.JIRA_USE_SITE_API === 'true') return false;
  if(process.env.JIRA_USE_SCOPED_GATEWAY === '1' || process.env.JIRA_USE_SCOPED_GATEWAY === 'true') return true;
  return !!cloudId;
}

(async function main(){
  if(!cloudId && baseUrl && wantsScopedGateway()){
    const id = await fetchTenantCloudId();
    if(id){
      cloudId = String(id).trim();
      console.log('NOTE: resolved cloudId from site /_edge/tenant_info (scoped gateway).');
    }
  }

  const myself = await requestJson(urlOnOrigin('/rest/api/3/myself'), 'GET');
  if(myself.status >= 200 && myself.status < 300 && myself.json){
    const me = myself.json;
    console.log('OK: authenticated as', me.displayName || me.emailAddress || me.accountId);
    console.log('    accountId:', me.accountId);
    if(cloudId) console.log('    mode: scoped gateway cloudId=' + cloudId);
    process.exit(0);
  }

  const scopeGap = myself.json && /scope/i.test(String(myself.json.message || ''));
  if(myself.status === 401 || myself.status === 403){
    // Scoped tokens with only read:jira-work cannot call /myself (needs read:jira-user).
    // Prove auth via issue search instead.
    const searchPayload = {
      jql: 'assignee = currentUser() ORDER BY updated DESC',
      maxResults: 1,
      fields: ['summary', 'assignee']
    };
    let search = await requestJson(urlOnOrigin('/rest/api/3/search/jql'), 'POST', searchPayload);
    let viaSiteFallback = false;
    if((search.status === 401 || search.status === 403) && cloudId && baseUrl &&
        process.env.JIRA_USE_SITE_API !== '1' && process.env.JIRA_USE_SITE_API !== 'true'){
      const siteUrl = new URL('/rest/api/3/search/jql', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
      search = await requestJson(siteUrl, 'POST', searchPayload);
      viaSiteFallback = search.status >= 200 && search.status < 300;
      if(viaSiteFallback){
        console.log('NOTE: gateway returned ' + myself.status + '; search/jql succeeded via site URL fallback.');
      }
    }
    if(search.status >= 200 && search.status < 300){
      const issues = (search.json && search.json.issues) || [];
      const name = issues[0] && issues[0].fields && issues[0].fields.assignee
        && (issues[0].fields.assignee.displayName || issues[0].fields.assignee.emailAddress);
      console.log('OK: scoped token can search issues' + (name ? (' (assignee sample: ' + name + ')') : ''));
      if(scopeGap){
        console.log('NOTE: /myself failed (HTTP ' + myself.status + ', scope gap). Add scope read:jira-user for profile greeting.');
      } else {
        console.log('NOTE: /myself failed (HTTP ' + myself.status + '); search/jql succeeded' +
          (viaSiteFallback ? ' via site URL (gateway fallback).' : (cloudId ? ' via scoped gateway.' : ' via site URL.')));
      }
      if(cloudId && !viaSiteFallback) console.log('    mode: scoped gateway cloudId=' + cloudId);
      process.exit(0);
    }
    console.error('FAIL: Jira rejected credentials (HTTP ' + myself.status + ' on /myself' +
      (search.status ? ('; search/jql HTTP ' + search.status) : '') + ').');
    if(myself.json && myself.json.message) console.error('    myself:', myself.json.message);
    if(search.json && (search.json.message || search.json.errorMessages)){
      console.error('    search:', search.json.message || (search.json.errorMessages && search.json.errorMessages.join('; ')));
    }
    if(!cloudId){
      console.error('HINT: scoped API tokens require JIRA_CLOUD_ID and api.atlassian.com/ex/jira/{cloudId}.');
    } else {
      console.error('HINT: 401 usually means wrong JIRA_EMAIL or JIRA_API_TOKEN.');
      console.error('      Confirm the email at https://id.atlassian.com/manage-profile/security/api-tokens');
      console.error('      matches .env exactly, then create a new token (read:jira-work minimum).');
    }
    process.exit(1);
  }

  console.error('FAIL: HTTP ' + myself.status + ' — ' + String(myself.raw || '').slice(0, 300));
  process.exit(1);
})().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

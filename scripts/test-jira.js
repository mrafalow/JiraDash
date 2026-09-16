#!/usr/bin/env node
/**
 * First Jira connectivity check (uses .env via the same rules as server.js).
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
const cloudId = (process.env.JIRA_CLOUD_ID || '').trim();

if(!email || !token || (!baseUrl && !cloudId)){
  console.error('FAIL: Set JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL (or JIRA_CLOUD_ID) in .env');
  process.exit(1);
}

const origin = cloudId
  ? 'https://api.atlassian.com/ex/jira/' + encodeURIComponent(cloudId)
  : baseUrl;

const target = new URL('/rest/api/3/myself', origin.endsWith('/') ? origin : origin + '/');
const auth = Buffer.from(email + ':' + token).toString('base64');
const lib = target.protocol === 'http:' ? http : https;

const req = lib.request({
  protocol: target.protocol,
  hostname: target.hostname,
  port: target.port || 443,
  path: target.pathname,
  method: 'GET',
  headers: {
    Authorization: 'Basic ' + auth,
    Accept: 'application/json',
    'User-Agent': 'StudioTitanLocal/1.0'
  }
}, (res) => {
  let raw = '';
  res.on('data', c => raw += c);
  res.on('end', () => {
    if(res.statusCode === 401 || res.statusCode === 403){
      console.error('FAIL: Jira rejected credentials (HTTP ' + res.statusCode + '). Rotate/paste a fresh token in .env as JIRA_API_TOKEN=...');
      process.exit(1);
    }
    if(res.statusCode < 200 || res.statusCode >= 300){
      console.error('FAIL: HTTP ' + res.statusCode + ' — ' + raw.slice(0, 300));
      process.exit(1);
    }
    try{
      const me = JSON.parse(raw);
      console.log('OK: authenticated as', me.displayName || me.emailAddress || me.accountId);
      console.log('    accountId:', me.accountId);
      process.exit(0);
    } catch(e){
      console.error('FAIL: could not parse response');
      process.exit(1);
    }
  });
});
req.on('error', (err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
req.end();

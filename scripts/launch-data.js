'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function readJson(name, fallback) {
  const p = path.join(DATA, name);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(name, data) {
  const p = path.join(DATA, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function loadLaunchConfig() {
  const allow = readJson('launch-epics.json', { allowlist: [] });
  const runbooks = readJson('launch-runbooks.json', {});
  const template = readJson('launch-runbook-template.json', { sections: [] });
  return {
    allowlist: allow.allowlist || [],
    runbooks,
    template
  };
}

function loadLaunchProgress() {
  return readJson('launch-progress.json', {});
}

function saveLaunchProgress(progress) {
  writeJson('launch-progress.json', progress || {});
}

module.exports = {
  loadLaunchConfig,
  loadLaunchProgress,
  saveLaunchProgress
};

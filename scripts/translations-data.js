'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, writeJson, DATA } = require('./launch-data.js');

const CHOICES_FILE = 'translations-choices.json';
const BACKUP_NAME = 'translations-choices.bak.json';

function loadTranslationsChoices() {
  return readJson(CHOICES_FILE, {});
}

function writeTranslationsChoicesFile(choices) {
  const o = choices && typeof choices === 'object' ? choices : {};
  const filePath = path.join(DATA, CHOICES_FILE);
  try {
    if (fs.existsSync(filePath)) {
      const backupDir = path.join(DATA, 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(filePath, path.join(backupDir, BACKUP_NAME));
    }
  } catch (_) {
    /* backup best-effort */
  }
  writeJson(CHOICES_FILE, o);
  return o;
}

/** Merge patch keys; omit or invalid values remove the ticket key. */
function applyChoicesPatch(current, patch) {
  const base = current && typeof current === 'object' ? Object.assign({}, current) : {};
  const delta = patch && typeof patch === 'object' ? patch : {};
  Object.keys(delta).forEach((key) => {
    const v = delta[key];
    if (v === 'needed' || v === 'not-needed') base[key] = v;
    else delete base[key];
  });
  return base;
}

function saveTranslationsChoices(choices) {
  return writeTranslationsChoicesFile(choices);
}

function patchTranslationsChoice(ticketKey, choice) {
  if (!ticketKey) return loadTranslationsChoices();
  const current = loadTranslationsChoices();
  const patch = {};
  if (choice === 'needed' || choice === 'not-needed') patch[ticketKey] = choice;
  else patch[ticketKey] = null;
  return writeTranslationsChoicesFile(applyChoicesPatch(current, patch));
}

function replaceTranslationsChoices(choices) {
  const incoming = choices && typeof choices === 'object' ? choices : {};
  const cleaned = {};
  Object.keys(incoming).forEach((key) => {
    const v = incoming[key];
    if (v === 'needed' || v === 'not-needed') cleaned[key] = v;
  });
  return writeTranslationsChoicesFile(cleaned);
}

function mergeTranslationsChoices(serverChoices, localChoices) {
  const server = serverChoices && typeof serverChoices === 'object' ? serverChoices : {};
  const local = localChoices && typeof localChoices === 'object' ? localChoices : {};
  return applyChoicesPatch(server, local);
}

module.exports = {
  loadTranslationsChoices,
  saveTranslationsChoices,
  patchTranslationsChoice,
  replaceTranslationsChoices,
  mergeTranslationsChoices,
  applyChoicesPatch
};

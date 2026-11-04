'use strict';

const store = {};
global.localStorage = {
  getItem(k){ return store[k] != null ? store[k] : null; },
  setItem(k, v){ store[k] = String(v); },
  removeItem(k){ delete store[k]; }
};

const tr = require('../translations-review.js');

function ticket(overrides){
  return Object.assign({
    key: 'WDW-1',
    assigneeIsCurrentUser: true,
    subtasks: [
      { type: 'PRODVAL', status: 'Closed', summary: 'PROD VALIDATION | x' }
    ]
  }, overrides || {});
}

function assert(cond, msg){
  if(!cond) throw new Error(msg || 'assert failed');
}

function run(){
  store[tr.STORAGE_KEY] = JSON.stringify({});

  const closedProd = ticket();
  assert(tr.closedTranslationsState(closedProd).state === 'review', 'prod val closed → review');

  tr.saveChoice('WDW-1', 'needed');
  assert(tr.closedTranslationsState(closedProd).state === 'not-started', 'needed no subtask → not-started');

  const withTrOpen = ticket({
    subtasks: [
      { type: 'PRODVAL', status: 'Closed', summary: 'PROD VALIDATION' },
      { type: 'TRANSLATIONS', status: 'Not Started', summary: 'TRANSLATIONS | es-US' }
    ]
  });
  assert(tr.closedTranslationsState(withTrOpen).state === 'not-started', 'TR not started → not-started');

  const inFlight = ticket({
    subtasks: [
      { type: 'PRODVAL', status: 'Closed', summary: 'PROD VALIDATION' },
      { type: 'TRANSLATIONS', status: 'In Progress', summary: 'TRANSLATIONS | es-US' }
    ]
  });
  assert(tr.closedTranslationsState(inFlight).state === 'pending', 'TR in progress → pending');

  tr.saveChoice('WDW-1', 'not-needed');
  const marked = tr.closedTranslationsState(inFlight);
  assert(marked.state === 'all-closed', 'not-needed → all-closed');
  assert(marked.reason === 'marked-not-needed', 'not-needed reason');

  tr.saveChoice('WDW-1', 'clear');
  assert(tr.closedTranslationsState(inFlight).state === 'pending', 'clear choice → re-scan pending');

  const closedTr = ticket({
    key: 'WDW-3',
    subtasks: [
      { type: 'PRODVAL', status: 'Closed', summary: 'PROD VALIDATION' },
      { type: 'TRANSLATIONS', status: 'Closed', summary: 'TRANSLATIONS | es-US' }
    ]
  });
  const jiraClosed = tr.closedTranslationsState(closedTr);
  assert(jiraClosed.state === 'all-closed' && jiraClosed.reason === 'subtask-closed', 'Jira closed → subtask-closed');

  console.log('test-translations-review: ok');
}

run();

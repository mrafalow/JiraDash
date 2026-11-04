'use strict';

const td = require('./translations-data.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

const merged = td.applyChoicesPatch(
  { 'WDW-1': 'needed', 'WDW-2': 'not-needed' },
  { 'WDW-2': 'needed', 'WDW-3': 'not-needed', 'WDW-4': null }
);
assert(merged['WDW-1'] === 'needed', 'keep WDW-1');
assert(merged['WDW-2'] === 'needed', 'patch WDW-2');
assert(merged['WDW-3'] === 'not-needed', 'add WDW-3');
assert(merged['WDW-4'] === undefined, 'null removes key');

const union = td.mergeTranslationsChoices(
  { 'WDW-A': 'not-needed' },
  { 'WDW-B': 'needed' }
);
assert(union['WDW-A'] === 'not-needed' && union['WDW-B'] === 'needed', 'merge union');

console.log('test-translations-data: ok');

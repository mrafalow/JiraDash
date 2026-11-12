'use strict';

const { classifySubtaskType } = require('../prioritize.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

assert(
  classifySubtaskType('PR | Alt Text Review | WDW | Dine') === 'ALTTEXT',
  'PR-prefixed alt text review → ALTTEXT'
);
assert(
  classifySubtaskType('ALT TEXT | es-US captions') === 'ALTTEXT',
  'ALT TEXT prefix'
);
assert(
  classifySubtaskType('PR | Partner review | page') === 'PR',
  'real PR unchanged'
);
assert(
  classifySubtaskType('COPY | mention alt text in body') === 'COPY',
  'COPY prefix wins over alt text mention'
);
assert(
  classifySubtaskType('Alt-text and captions | WDW | Dine | California Grill') === 'ALTTEXT',
  'hyphenated Alt-text and captions parent-style summary'
);

console.log('test-classify-subtask: ok');

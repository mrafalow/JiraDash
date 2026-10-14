'use strict';

const { runPrioritizeFixtures } = require('../prioritize.js');

try {
  const result = runPrioritizeFixtures();
  console.log('OK — ' + result.cases + ' prioritize fixtures passed.');
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

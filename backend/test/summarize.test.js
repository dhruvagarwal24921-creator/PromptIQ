const test = require('node:test');
const assert = require('node:assert');
const { SUMMARIZE_SYSTEM_PROMPT } = require('../src/services/summarizer');

test('Summarize system prompt contains structured migration requirements', () => {
  assert.strictEqual(typeof SUMMARIZE_SYSTEM_PROMPT, 'string');
  assert.match(SUMMARIZE_SYSTEM_PROMPT, /## Session Migration Context/);
  assert.match(SUMMARIZE_SYSTEM_PROMPT, /### Goal/);
  assert.match(SUMMARIZE_SYSTEM_PROMPT, /### What Was Done/);
  assert.match(SUMMARIZE_SYSTEM_PROMPT, /### Current State/);
  assert.match(SUMMARIZE_SYSTEM_PROMPT, /### Latest Working Code/);
  assert.match(SUMMARIZE_SYSTEM_PROMPT, /### What's Pending/);
});

test('Summarize system prompt specifies code preservation rule', () => {
  assert.match(SUMMARIZE_SYSTEM_PROMPT, /PRESERVE all code exactly as-is/);
});

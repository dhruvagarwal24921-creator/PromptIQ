const test = require('node:test');
const assert = require('node:assert');
const { validateEnhancement } = require('../src/services/validate');

test('Empty output fails', () => {
  const result = validateEnhancement('draft', '   ');
  assert.strictEqual(result.ok, false);
});

test('Code block preserved passes', () => {
  const draft = 'fix\n```js\nvar a = 1;\n```';
  const enhanced = 'Please fix the following code:\n```js\nvar a = 1;\n```';
  const result = validateEnhancement(draft, enhanced);
  assert.strictEqual(result.ok, true);
});

test('Code block altered fails', () => {
  const draft = 'fix\n```js\nvar a = 1;\n```';
  const enhanced = 'Please fix the following code:\n```js\nvar a = 2;\n```';
  const result = validateEnhancement(draft, enhanced);
  assert.strictEqual(result.ok, false);
});

test('Long paragraph preserved passes', () => {
  const longText = 'A'.repeat(301);
  const draft = `Summarize this:\n\n${longText}`;
  const enhanced = `Act as an editor. Summarize this:\n\n${longText}`;
  const result = validateEnhancement(draft, enhanced);
  assert.strictEqual(result.ok, true);
});

test('Long paragraph altered fails', () => {
  const longText = 'A'.repeat(301);
  const draft = `Summarize this:\n\n${longText}`;
  const enhanced = `Act as an editor. Summarize this:\n\n${longText.substring(0, 300)}B`;
  const result = validateEnhancement(draft, enhanced);
  assert.strictEqual(result.ok, false);
});

test('Length limit passes', () => {
  const draft = 'hi';
  const enhanced = 'A'.repeat(400); // 4 * 2 + 400 = 408
  const result = validateEnhancement(draft, enhanced);
  assert.strictEqual(result.ok, true);
});

test('Length limit fails', () => {
  const draft = 'hi';
  const enhanced = 'A'.repeat(650);
  const result = validateEnhancement(draft, enhanced);
  assert.strictEqual(result.ok, false);
});

test('Forbidden tags fails', () => {
  const draft = 'hi';
  const enhanced = 'Hello <draft> hi </draft>';
  const result = validateEnhancement(draft, enhanced);
  assert.strictEqual(result.ok, false);
});

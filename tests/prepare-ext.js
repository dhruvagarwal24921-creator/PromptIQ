// Playwright cannot see inside a *closed* shadow root, and ui.js (correctly) mounts PromptIQ's chips in one.
// Rather than weakening the shipped extension, the tests load a throwaway copy in which that single line is 'open'.
// Production code in ../extension is never modified.
const fs = require('fs');
const path = require('path');

module.exports = function prepareExtensionUnderTest() {
  const src = path.join(__dirname, '..', 'extension');
  const dst = path.join(__dirname, '.ext-under-test');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });

  const ui = path.join(dst, 'content', 'ui.js');
  const code = fs.readFileSync(ui, 'utf8');
  const patched = code.replace("attachShadow({ mode: 'closed' })", "attachShadow({ mode: 'open' })");
  if (patched === code) throw new Error("prepare-ext: could not find attachShadow({ mode: 'closed' }) in ui.js; update this helper.");
  fs.writeFileSync(ui, patched);
  return dst;
};

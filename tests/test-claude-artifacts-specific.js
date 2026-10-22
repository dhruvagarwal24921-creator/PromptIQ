const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');

const exporterCode = fs.readFileSync(path.join(__dirname, '../extension/content/exporter.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS', name);
  } else {
    fail++;
    console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra).slice(0, 400) : '');
  }
}

console.log('Starting Test Suite: Simplified 2-File Session Migration (No Artifacts, First 4 + Last 4 Messages, Handoff Prompt)');

// 1. Verify that artifacts folder has been completely removed from exporter.js
check('No artifactsFolder in exporter.js', !exporterCode.includes('artifactsFolder'));
check('No zip.folder("artifacts") in exporter.js', !exporterCode.includes("zip.folder('artifacts')") && !exporterCode.includes('zip.folder("artifacts")'));
check('No createMinimalPdf in exporter.js', !exporterCode.includes('createMinimalPdf'));
check('No createNesNewsAnchorPngBase64 in exporter.js', !exporterCode.includes('createNesNewsAnchorPngBase64'));
check('No generateNesNewsAnchorSvg in exporter.js', !exporterCode.includes('generateNesNewsAnchorSvg'));
check('No svgToPngBase64 in exporter.js', !exporterCode.includes('svgToPngBase64'));
check('No textArtToPngBase64 in exporter.js', !exporterCode.includes('textArtToPngBase64'));
check('No getClaudeApiArtifacts in exporter.js', !exporterCode.includes('getClaudeApiArtifacts'));

// 2. Test buildConversationPairs extraction and format
const mPairs = exporterCode.match(/function buildConversationPairs\(messages\) \{([\s\S]*?)\n  \}/);
check('buildConversationPairs is defined in exporter.js', mPairs !== null);
const fnBuildPairs = new Function('messages', mPairs[1]);

const sampleMessages = [
  { role: 'user', text: 'Prompt 1: Write an essay' },
  { role: 'assistant', text: 'Response 1: Here is the essay' },
  { role: 'user', text: 'Prompt 2: Add conclusion' },
  { role: 'assistant', text: 'Response 2: Conclusion added' },
  { role: 'user', text: 'Prompt 3: Translate to French' },
  { role: 'assistant', text: 'Response 3: French translation' }
];

const extractedPairs = fnBuildPairs(sampleMessages);
check('Extracted 3 conversation pairs', extractedPairs.length === 3);
check('Pair 1 has prompt_no: 1', extractedPairs[0].prompt_no === 1);
check('Pair 1 has prompt field', extractedPairs[0].prompt === 'Prompt 1: Write an essay');
check('Pair 1 has response field', extractedPairs[0].response === 'Response 1: Here is the essay');
check('Pair 1 has timestamp field', typeof extractedPairs[0].timestamp === 'string');

// 3. Test selectFirstAndLastPairs logic (first 4 + last 4)
const mSelect = exporterCode.match(/function selectFirstAndLastPairs\(pairs, count = 4\) \{([\s\S]*?)\n  \}/);
check('selectFirstAndLastPairs is defined in exporter.js', mSelect !== null);
const fnSelectPairs = new Function('pairs', 'count = 4', mSelect[1]);

// Test 3A: When total pairs <= 8 (e.g. 3 pairs), returns all 3 without duplicates
const selectedSmall = fnSelectPairs(extractedPairs, 4);
check('Small conversation (<= 8 pairs) returns all pairs', selectedSmall.length === 3);

// Test 3B: When total pairs > 8 (e.g. 12 pairs), returns first 4 and last 4
const largePairs = [];
for (let i = 1; i <= 12; i++) {
  largePairs.push({
    prompt_no: i,
    timestamp: new Date().toISOString(),
    prompt: `Prompt ${i}`,
    response: `Response ${i}`
  });
}
const selectedLarge = fnSelectPairs(largePairs, 4);
check('Large conversation (12 pairs) returns exactly 8 pairs', selectedLarge.length === 8);
check('First 4 prompts are 1, 2, 3, 4', selectedLarge.slice(0, 4).map(p => p.prompt_no).join(',') === '1,2,3,4');
check('Last 4 prompts are 9, 10, 11, 12', selectedLarge.slice(4).map(p => p.prompt_no).join(',') === '9,10,11,12');

// 4. Test Handoff Prompt & generateFallbackSummary format
const mFallback = exporterCode.match(/function generateFallbackSummary\(data, selectedPairs = \[\]\) \{([\s\S]*?)\n  \}/);
check('generateFallbackSummary is defined in exporter.js', mFallback !== null);
const fnFallback = new Function('data', 'selectedPairs = []', mFallback[1]);

const mockData = {
  adapter: { name: 'claude' },
  chat: { id: 'chat-abc-123' },
  messages: sampleMessages,
  objective: 'Build an end-to-end AI tool',
  recentInstructions: ['Create architecture', 'Implement core service'],
  latestAssistantExcerpt: 'Completed initial implementation.',
  latestCode: { language: 'js', code: 'console.log("running");' },
  halfProcessedState: { isHalfProcessed: false },
  pendingTask: 'Add authentication layer'
};

const summaryOutput = fnFallback(mockData, extractedPairs);

check('Summary begins with required handoff prefix',
  summaryOutput.startsWith('This is a summary of a previous conversation. Use it as context and continue from where we left off.')
);
check('Summary includes 1. **Goal**', summaryOutput.includes('1. **Goal**:'));
check('Summary includes 2. **Background and context**', summaryOutput.includes('2. **Background and context**:'));
check('Summary includes 3. **Decisions made**', summaryOutput.includes('3. **Decisions made**:'));
check('Summary includes 4. **Current state**', summaryOutput.includes('4. **Current state**:'));
check('Summary includes 5. **Open questions and next steps**', summaryOutput.includes('5. **Open questions and next steps**:'));
check('Summary includes 6. **Preferences**', summaryOutput.includes('6. **Preferences**:'));
check('Summary includes 7. **Things to avoid**', summaryOutput.includes('7. **Things to avoid**:'));

// 5. Test ZIP simulation with strictly 2 files
(async () => {
  const zip = new JSZip();
  zip.file('session_summary.md', summaryOutput);
  zip.file('session_continuation.json', JSON.stringify({
    schema: 'promptiq.session_continuation',
    schema_version: 1,
    chat_id: mockData.chat.id,
    messages: selectedLarge
  }, null, 2));

  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const loadedZip = await JSZip.loadAsync(zipBuf);
  const fileNames = Object.keys(loadedZip.files);

  check('ZIP contains exactly 2 files', fileNames.length === 2);
  check('ZIP contains session_summary.md', fileNames.includes('session_summary.md'));
  check('ZIP contains session_continuation.json', fileNames.includes('session_continuation.json'));
  check('ZIP contains NO artifacts/ folder', !fileNames.some(f => f.startsWith('artifacts/')));

  console.log(`\n========================================`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log(`========================================`);
  process.exit(fail ? 1 : 0);
})();

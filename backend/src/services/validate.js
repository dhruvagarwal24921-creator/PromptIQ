function validateEnhancement(draft, enhanced) {
  if (!enhanced || !enhanced.trim()) {
    return { ok: false, reason: 'Empty output' };
  }
  
  const forbidden = [
    '<draft>',
    '<recent_conversation>',
    '<past_enhanced_prompts_context>',
    '<classification_tag>',
    '<purpose_tag>'
  ];
  for (const tag of forbidden) {
    if (enhanced.includes(tag)) {
      return { ok: false, reason: `Output contains forbidden tag ${tag}` };
    }
  }
  
  const draftLen = draft.length;
  const enhancedLen = enhanced.length;
  if (enhancedLen > draftLen * 4 + 400) {
    return { ok: false, reason: 'Output exceeds length limits' };
  }
  
  // Code block check
  const codeBlockRegex = /```[\s\S]*?```/g;
  const draftBlocks = draft.match(codeBlockRegex) || [];
  for (const block of draftBlocks) {
    if (!enhanced.includes(block)) {
      return { ok: false, reason: 'Code block altered or missing' };
    }
  }
  
  // Pasted paragraph check (>300 chars)
  const normDraft = draft.replace(/\r\n/g, '\n').split('\n\n');
  for (const p of normDraft) {
    const trimmed = p.trim();
    if (trimmed.length > 300) {
      const normEnhanced = enhanced.replace(/\r\n/g, '\n');
      if (!normEnhanced.includes(trimmed)) {
        return { ok: false, reason: 'Long pasted paragraph altered or missing' };
      }
    }
  }
  
  return { ok: true, reason: null };
}

module.exports = { validateEnhancement };
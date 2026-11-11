export function isChatGptCodexModel(modelId: string): boolean {
  return modelId === 'jarvis-codex';
}

export function modelDisplayName(modelId: string): string {
  return isChatGptCodexModel(modelId) ? 'Codex · ChatGPT' : modelId;
}

export function matchesModelQuery(modelId: string, query: string): boolean {
  const needle = query.toLowerCase();
  return modelId.toLowerCase().includes(needle)
    || modelDisplayName(modelId).toLowerCase().includes(needle);
}

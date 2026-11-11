export const CODEX_DEFAULT_MODEL = 'jarvis-codex';
const CODEX_MODEL_PREFIX = `${CODEX_DEFAULT_MODEL}/`;

export function codexUpstreamModel(modelId: string): string | null {
  if (!modelId.startsWith(CODEX_MODEL_PREFIX)) return null;
  return modelId.slice(CODEX_MODEL_PREFIX.length) || null;
}

export function isChatGptCodexModel(modelId: string): boolean {
  return modelId === CODEX_DEFAULT_MODEL || codexUpstreamModel(modelId) !== null;
}

export function modelDisplayName(modelId: string, displayName?: string): string {
  if (modelId === CODEX_DEFAULT_MODEL) return 'Codex · ChatGPT';
  const upstream = codexUpstreamModel(modelId);
  return upstream ? `Codex · ${displayName || upstream}` : modelId;
}

export function matchesModelQuery(modelId: string, query: string, displayName?: string): boolean {
  const needle = query.toLowerCase();
  return modelId.toLowerCase().includes(needle)
    || modelDisplayName(modelId, displayName).toLowerCase().includes(needle);
}

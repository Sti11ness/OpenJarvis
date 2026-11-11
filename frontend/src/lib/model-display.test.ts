import { describe, expect, it } from 'vitest';
import { codexUpstreamModel, isChatGptCodexModel, matchesModelQuery, modelDisplayName } from './model-display';

describe('model presentation', () => {
  it('names the ChatGPT-backed Codex alias without relabeling other models', () => {
    expect(modelDisplayName('jarvis-codex')).toBe('Codex · ChatGPT');
    expect(modelDisplayName('openai/gpt-4o')).toBe('openai/gpt-4o');
    expect(modelDisplayName('qwen3.5:4b')).toBe('qwen3.5:4b');
  });

  it('finds the Codex alias by display name and by its existing ID', () => {
    expect(matchesModelQuery('jarvis-codex', 'CHATGPT')).toBe(true);
    expect(matchesModelQuery('jarvis-codex', 'jarvis-codex')).toBe(true);
    expect(matchesModelQuery('qwen3.5:4b', 'qwen')).toBe(true);
    expect(matchesModelQuery('qwen3.5:4b', 'codex')).toBe(false);
  });

  it('presents qualified Codex choices while preserving their exact routing IDs', () => {
    const id = 'jarvis-codex/gpt-6.1-sol';
    expect(codexUpstreamModel(id)).toBe('gpt-6.1-sol');
    expect(isChatGptCodexModel(id)).toBe(true);
    expect(modelDisplayName(id)).toBe('Codex · gpt-6.1-sol');
    expect(modelDisplayName(id, 'GPT-6.1-Sol')).toBe('Codex · GPT-6.1-Sol');
    expect(matchesModelQuery(id, 'gpt-6.1-sol')).toBe(true);
    expect(isChatGptCodexModel('jarvis-codex/')).toBe(false);
    expect(isChatGptCodexModel('my-jarvis-codex')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { matchesModelQuery, modelDisplayName } from './model-display';

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
});

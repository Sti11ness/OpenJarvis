// Modified in the Codex onboarding fork.
import { describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../types';
import { getSetupModelOverride } from './SetupScreen';

vi.mock('../lib/store', () => ({ useAppStore: vi.fn() }));

const model = (id: string): ModelInfo => ({ id, object: 'model', created: 0, owned_by: 'openjarvis' });

describe('desktop setup model selection', () => {
  it.each([
    ['codex', 'jarvis-codex'],
    ['openai', 'openai/fixture-model'],
  ] as const)('chooses the configured %s model even when a local model is already selected', (source, configured) => {
    const models = [model('qwen3.5:4b'), model(configured)];

    expect(getSetupModelOverride(models, source, configured, 'qwen3.5:4b')).toBe(configured);
  });

  it('uses the first chat model advertised by the server when source lookup fails', () => {
    const models = [model('nomic-embed-text'), model('jarvis-codex'), model('qwen3.5:4b')];

    expect(getSetupModelOverride(models, 'codex', undefined, '')).toBe('jarvis-codex');
  });

  it('preserves an existing selection for the original source modes', () => {
    const models = [model('server-model'), model('selected-model')];

    expect(getSetupModelOverride(models, 'custom', 'server-model', 'selected-model')).toBeUndefined();
    expect(getSetupModelOverride(models, 'ollama', 'server-model', '')).toBe('server-model');
  });
});

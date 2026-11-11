// Modified in the Codex onboarding fork.
import { describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../types';
import { getSetupModelOverride, localizeSetupDetail } from './SetupScreen';

vi.mock('../lib/store', () => ({ useAppStore: vi.fn() }));

const model = (id: string): ModelInfo => ({ id, object: 'model', created: 0, owned_by: 'openjarvis' });

it('localizes startup progress while preserving identifiers and diagnostics', () => {
  expect(localizeSetupDetail('Starting API server...')).toBe('Запускаем сервер API…');
  expect(localizeSetupDetail('Downloading qwen3.5:4b... (this may take a minute)')).toBe('Скачиваем qwen3.5:4b…');
  expect(localizeSetupDetail('Connection failed (HTTP 503)')).toBe('Connection failed (HTTP 503)');
});

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

it('keeps English UI copy available when the build selects it', async () => {
  vi.stubEnv('VITE_UI_LOCALE', 'en');
  vi.resetModules();
  try {
    const { uiLanguage, uiLabels } = await import('../lib/locale');
    expect(uiLanguage).toBe('en');
    expect(uiLabels.codex).toBe('Codex via ChatGPT');
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

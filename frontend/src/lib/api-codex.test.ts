import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCodexModels, preloadModel } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('Codex models in the personal app', () => {
  it('discovers the effective default and keeps qualified model IDs', async () => {
    const catalog = {
      default_model: 'gpt-6.1-sol',
      models: [{
        id: 'jarvis-codex/gpt-6.1-sol',
        model: 'gpt-6.1-sol',
        display_name: 'GPT-6.1-Sol',
        is_default: true,
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(catalog));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchCodexModels(controller.signal)).resolves.toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/codex\/models$/),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('does not ask Ollama to preload either Codex ID', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await preloadModel('jarvis-codex', 'openjarvis');
    await preloadModel('jarvis-codex/gpt-6.1-sol', 'codex_app_server');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

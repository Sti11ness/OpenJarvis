// Modified in the Codex onboarding fork.
import { invoke } from '@tauri-apps/api/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexAccountSetup,
  CustomEndpointSetup,
  InferenceRecoveryButton,
  InferenceSourceChooser,
  OllamaConsent,
  OpenAIKeySetup,
  inferenceSetupReducer,
  persistAndStartInferenceSource,
  type InferenceSourceSubmission,
} from './InferenceSourceSetup';
import { getCodexLoginStatus, loginToCodex } from '../lib/api';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.unstubAllGlobals();
});

describe('first-run inference source navigation', () => {
  it('requires a second, explicit confirmation before local setup', () => {
    expect(inferenceSetupReducer('choose', 'choose_ollama')).toBe('ollama');
    expect(inferenceSetupReducer('ollama', 'back')).toBe('choose');
  });

  it('lets custom endpoint setup cancel safely back to the chooser', () => {
    expect(inferenceSetupReducer('choose', 'choose_custom')).toBe('custom');
    expect(inferenceSetupReducer('custom', 'back')).toBe('choose');
  });

  it('renders all four sources before startup', () => {
    const html = renderToStaticMarkup(<InferenceSourceChooser onChoose={vi.fn()} />);

    expect(html).toContain('Codex через ChatGPT');
    expect(html).toContain('Ключ OpenAI API');
    expect(html).toContain('Локальная Ollama');
    expect(html).toContain('OpenAI-совместимый сервер');
    expect(html).toContain('Настройка начнётся после подтверждения выбора.');
    expect(html).not.toContain('Настраиваем локальный запуск');
  });

  it('opens separate Codex and OpenAI setup steps with a back path', () => {
    expect(inferenceSetupReducer('choose', 'choose_codex')).toBe('codex');
    expect(inferenceSetupReducer('codex', 'back')).toBe('choose');
    expect(inferenceSetupReducer('choose', 'choose_openai')).toBe('openai');
    expect(inferenceSetupReducer('openai', 'back')).toBe('choose');
  });

  it('offers sign-in for a logged-out Codex and Continue for an existing ChatGPT login', () => {
    const callbacks = { onBack: vi.fn(), onSignIn: vi.fn(), onConfirm: vi.fn() };
    const signedOut = renderToStaticMarkup(<CodexAccountSetup status="signed-out" {...callbacks} />);
    const signedIn = renderToStaticMarkup(<CodexAccountSetup status="signed-in" {...callbacks} />);

    expect(signedOut).toContain('Войти через ChatGPT');
    expect(signedIn).toContain('Codex уже подключён к ChatGPT на этом компьютере');
    expect(signedIn).toContain('>Продолжить</button>');
    expect(signedIn).not.toContain('Войти через ChatGPT');
  });

  it('keeps the Codex action disabled while checking the current account', () => {
    const html = renderToStaticMarkup(
      <CodexAccountSetup status="checking" onBack={vi.fn()} onSignIn={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(html).toContain('Проверяем вход в Codex');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Проверяем вход…/);
  });

  it('requires a model and a masked key for OpenAI setup', () => {
    const html = renderToStaticMarkup(<OpenAIKeySetup onBack={vi.fn()} onConfirm={vi.fn()} />);

    expect(html).toMatch(/aria-label="Идентификатор модели"[^>]*required/);
    expect(html).toMatch(/aria-label="Ключ OpenAI API"[^>]*type="password"[^>]*required/);
    expect(html).toMatch(/type="submit"[^>]*disabled/);
  });

  it('discloses the model download and offers a no-op back path', () => {
    const html = renderToStaticMarkup(
      <OllamaConsent onBack={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(html).toContain('при необходимости скачает модель');
    expect(html).toContain('несколько гигабайт');
    expect(html).toContain('Кнопка «Назад» возвращает к выбору источника');
    expect(html).toContain('Использовать Ollama');
    expect(html).toContain('Назад');
  });

  it('requires endpoint coordinates and keeps an explicit cancel control', () => {
    const html = renderToStaticMarkup(
      <CustomEndpointSetup onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(html).toContain('Адрес сервера');
    expect(html).toContain('Идентификатор модели');
    expect(html).toMatch(/aria-label="Адрес сервера"[^>]*required/);
    expect(html).toMatch(/aria-label="Идентификатор модели"[^>]*required/);
    expect(html).toContain('Подключение к указанному серверу начнётся после отправки формы');
    expect(html).toContain('Отмена');
  });

  it('renders a source-change recovery action with a guarded busy state', () => {
    const ready = renderToStaticMarkup(
      <InferenceRecoveryButton recovering={false} onChange={vi.fn()} />,
    );
    const stopping = renderToStaticMarkup(
      <InferenceRecoveryButton recovering onChange={vi.fn()} />,
    );

    expect(ready).toContain('Сменить источник моделей');
    expect(ready).not.toMatch(/ disabled(?:=""|>)/);
    expect(stopping).toContain('Останавливаем настройку…');
    expect(stopping).toMatch(/ disabled(?:=""|>)/);
  });
});

describe('first-run inference source persistence', () => {
  it('uses the native account status and managed Codex sign-in commands', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(getCodexLoginStatus()).resolves.toBe(false);
    await expect(loginToCodex()).resolves.toBe(true);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['get_codex_login_status'],
      ['login_to_codex'],
    ]);
  });

  it.each([
    { kind: 'codex' },
    { kind: 'openai', model: 'fixture-model', apiKey: 'fixture-api-key' },
  ] as const)('stages the native $kind choice before starting the backend', async (source) => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });

    await persistAndStartInferenceSource(source);

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['set_inference_source', {
        kind: source.kind,
        model: 'model' in source ? source.model : null,
        host: null,
        engine: null,
        apiKey: 'apiKey' in source ? source.apiKey : null,
        pending: true,
      }],
      ['start_backend'],
    ]);
  });

  it('persists the exact choice before requesting backend startup', async () => {
    const calls: string[] = [];
    const persist = vi.fn(async (source: InferenceSourceSubmission) => {
      calls.push(`persist:${source.kind}`);
    });
    const start = vi.fn(async () => {
      calls.push('start');
    });

    await persistAndStartInferenceSource(
      { kind: 'custom', host: 'http://localhost:1234', model: 'local-model', engine: 'lmstudio' },
      persist,
      start,
    );

    expect(calls).toEqual(['persist:custom', 'start']);
    expect(persist).toHaveBeenCalledWith({
      kind: 'custom',
      host: 'http://localhost:1234',
      model: 'local-model',
      engine: 'lmstudio',
    });
  });

  it('does not start anything when persistence fails', async () => {
    const persist = vi.fn(async () => {
      throw new Error('secure storage unavailable');
    });
    const start = vi.fn(async () => {});

    await expect(
      persistAndStartInferenceSource({ kind: 'ollama' }, persist, start),
    ).rejects.toThrow('secure storage unavailable');
    expect(start).not.toHaveBeenCalled();
  });

  it('rolls a staged choice back when startup rejects', async () => {
    const calls: string[] = [];
    const persist = vi.fn(async () => {
      calls.push('persist');
    });
    const start = vi.fn(async () => {
      calls.push('start');
      throw new Error('endpoint unavailable');
    });
    const rollback = vi.fn(async () => {
      calls.push('rollback');
    });

    await expect(
      persistAndStartInferenceSource(
        { kind: 'custom', host: 'http://localhost:1234', model: 'missing' },
        persist,
        start,
        rollback,
      ),
    ).rejects.toThrow('endpoint unavailable');
    expect(calls).toEqual(['persist', 'start', 'rollback']);
  });
});

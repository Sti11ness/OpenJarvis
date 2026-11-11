import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('persists an in-app language change without changing existing settings', async () => {
  vi.stubEnv('VITE_UI_LOCALE', 'ru');
  storage.set('openjarvis-settings', '{"theme":"dark"}');
  const locale = await import('./locale');
  expect(locale.uiLabels.back).toBe('Назад');

  locale.setUiLanguage('en');
  expect(locale.uiLanguage).toBe('en');
  expect(locale.uiLabels.back).toBe('Back');
  expect(storage.get('openjarvis-settings')).toBe('{"theme":"dark"}');

  vi.resetModules();
  const restarted = await import('./locale');
  expect(restarted.uiLanguage).toBe('en');
  expect(restarted.uiLabels.back).toBe('Back');
});

it('offers both languages in Appearance and translates the selected control', async () => {
  vi.stubEnv('VITE_UI_LOCALE', 'ru');
  const { SettingsPage } = await import('../pages/SettingsPage');
  const { setUiLanguage } = await import('./locale');

  const russian = renderToStaticMarkup(<SettingsPage />);
  expect(russian).toContain('aria-label="Язык интерфейса"');
  expect(russian).toContain('<option value="ru" lang="ru" selected="">Русский</option>');
  expect(russian).toContain('<option value="en" lang="en">English</option>');

  setUiLanguage('en');
  const english = renderToStaticMarkup(<SettingsPage />);
  expect(english).toContain('aria-label="Interface language"');
  expect(english).toContain('<option value="en" lang="en" selected="">English</option>');
  expect(english).toContain('>Light</button>');
});

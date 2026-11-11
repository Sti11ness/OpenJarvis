// Modified in the personal Jarvis fork.
import { useSyncExternalStore } from 'react';

export type UiLanguage = 'ru' | 'en';
const LOCALE_KEY = 'openjarvis-ui-language';
const listeners = new Set<() => void>();

function readUiLanguage(): UiLanguage {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // Storage can be unavailable outside the desktop WebView.
  }
  return import.meta.env.VITE_UI_LOCALE === 'en' ? 'en' : 'ru';
}

export let uiLanguage = readUiLanguage();

export function setUiLanguage(language: UiLanguage): void {
  if (language === uiLanguage) return;
  try {
    localStorage.setItem(LOCALE_KEY, language);
  } catch {
    // Allow a session-only change if preferences cannot be written.
  }
  uiLanguage = language;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const currentLanguage = () => uiLanguage;

export function useUiLanguage(): UiLanguage {
  return useSyncExternalStore(subscribe, currentLanguage, currentLanguage);
}

export function t(russian: string, english: string): string {
  return uiLanguage === 'ru' ? russian : english;
}

export const uiLabels = {
  get back() { return t('Назад', 'Back'); },
  get cancel() { return t('Отмена', 'Cancel'); },
  get newChat() { return t('Новый чат', 'New chat'); },
  get modelId() { return t('Идентификатор модели', 'Model ID'); },
  get codex() { return t('Codex через ChatGPT', 'Codex via ChatGPT'); },
  get openaiKey() { return t('Ключ OpenAI API', 'OpenAI API key'); },
  get connecting() { return t('Подключаемся…', 'Connecting...'); },
  get saveAndConnect() { return t('Сохранить и подключиться', 'Save and connect'); },
  get loadingModel() { return t('Загружаем модель…', 'Loading model...'); },
  get deepResearch() { return t('Глубокое исследование', 'Deep Research'); },
};

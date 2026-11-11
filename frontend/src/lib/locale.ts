// Modified in the personal Jarvis fork.
export const uiLanguage = import.meta.env.VITE_UI_LOCALE === 'en' ? 'en' : 'ru';

export function t(russian: string, english: string): string {
  return uiLanguage === 'ru' ? russian : english;
}

export const uiLabels = {
  back: t('Назад', 'Back'),
  cancel: t('Отмена', 'Cancel'),
  newChat: t('Новый чат', 'New chat'),
  modelId: t('Идентификатор модели', 'Model ID'),
  codex: t('Codex через ChatGPT', 'Codex via ChatGPT'),
  openaiKey: t('Ключ OpenAI API', 'OpenAI API key'),
  connecting: t('Подключаемся…', 'Connecting...'),
  saveAndConnect: t('Сохранить и подключиться', 'Save and connect'),
  loadingModel: t('Загружаем модель…', 'Loading model...'),
  deepResearch: t('Глубокое исследование', 'Deep Research'),
};

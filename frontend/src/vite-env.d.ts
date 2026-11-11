/// <reference types="vite/client" />

// Modified in the personal Jarvis fork.
interface ImportMetaEnv {
  readonly VITE_UI_LOCALE?: 'ru' | 'en';
  readonly VITE_API_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

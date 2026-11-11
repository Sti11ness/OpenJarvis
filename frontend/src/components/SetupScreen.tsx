// Modified in the Codex onboarding fork.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, Cpu, Server, Database } from 'lucide-react';
import {
  getSetupStatus,
  fetchModels,
  fetchRecommendedModel,
  getInferenceSource,
  resetInferenceSource,
  type SetupStatus,
} from '../lib/api';
import { useAppStore } from '../lib/store';
import { isEmbedOnlyModel } from '../lib/model-capabilities';
import { t, uiLabels, uiLanguage } from '../lib/locale';
import type { ModelInfo } from '../types';
import { InferenceRecoveryButton, InferenceSourceSetup } from './InferenceSourceSetup';

const getSteps = () => [
  { key: 'ollama_ready', label: t('Среда запуска', 'Inference Engine'), icon: Cpu, detail: t('Запускаем Ollama…', 'Starting Ollama...') },
  { key: 'model_ready', label: t('Модель', 'AI Model'), icon: Database, detail: uiLabels.loadingModel },
  { key: 'server_ready', label: t('Сервер API', 'API Server'), icon: Server, detail: t('Запускаем сервер…', 'Starting server...') },
] as const;

const getRemoteSetup = (): Partial<Record<SetupStatus['source'], {
  summary: string;
  engine: string;
  model: string;
  modelLabel?: string;
}>> => ({
  custom: {
    summary: t('Подключаемся к вашему серверу моделей…', 'Connecting to your AI server...'),
    engine: t('Подключаемся к серверу…', 'Connecting to your server...'),
    model: t('Проверяем адрес сервера…', 'Checking endpoint...'),
    modelLabel: t('Адрес сервера', 'Endpoint'),
  },
  codex: {
    summary: t('Подключаемся к Codex через ChatGPT…', 'Connecting to Codex via ChatGPT...'),
    engine: t('Запускаем сервер Codex…', 'Starting the Codex app server...'),
    model: t('Проверяем доступ к Codex…', 'Checking Codex access...'),
  },
  openai: {
    summary: t('Подключаемся к OpenAI API…', 'Connecting to the OpenAI API...'),
    engine: t('Подключаемся к OpenAI…', 'Connecting to OpenAI...'),
    model: t('Проверяем доступ к модели…', 'Checking model access...'),
  },
});

type StepKey = ReturnType<typeof getSteps>[number]['key'];

const SETUP_STATUS_RU: Record<string, string> = {
  'Choose where OpenJarvis should run models.': 'Выберите источник моделей.',
  'Initializing...': 'Подготавливаем запуск…',
  'Starting inference engine...': 'Запускаем среду для моделей…',
  'Inference engine ready.': 'Среда запуска готова.',
  'Model ready.': 'Модель готова.',
  'Connected to custom endpoint.': 'Подключение к серверу установлено.',
  'Starting API server...': 'Запускаем сервер API…',
  'Downloading OpenJarvis (first launch)...': 'Скачиваем OpenJarvis для первого запуска…',
  'Installing dependencies (uv sync — may take 1-2 min on first boot)...': 'Устанавливаем зависимости. При первом запуске это может занять 1–2 минуты.',
  'Verifying Rust extension (openjarvis_rust)...': 'Проверяем расширение openjarvis_rust…',
  'All systems ready.': 'Всё готово.',
};

export function localizeSetupDetail(detail: string): string {
  if (uiLanguage === 'en') return detail;
  return SETUP_STATUS_RU[detail] ?? detail
    .replace(/^Checking for (.+)\.\.\.$/, 'Проверяем наличие $1…')
    .replace(/^Downloading (.+)\.\.\.(?: \(this may take a minute\))?$/, 'Скачиваем $1…')
    .replace(/^Using installed model (.+)\.$/, 'Используем установленную модель $1.')
    .replace(/^Connecting to (.+)\.\.\.$/, 'Подключаемся к $1…')
    .replace(/^Starting API server from (.+)\.\.\.$/, 'Запускаем сервер API из $1…')
    .replace(/^Connected to existing API server on port (\d+)\.$/, 'Подключились к работающему серверу API на порту $1.');
}

function isManagedRemoteSource(source: SetupStatus['source']): boolean {
  return source === 'codex' || source === 'openai';
}

export function getSetupModelOverride(
  models: ModelInfo[],
  source: SetupStatus['source'],
  preferredModel: string | undefined,
  currentSelection: string,
): string | undefined {
  if (currentSelection && !isManagedRemoteSource(source)) return undefined;
  const chatModels = models.filter((model) => !isEmbedOnlyModel(model.id));
  return chatModels.find((model) => model.id === preferredModel)?.id ?? chatModels[0]?.id;
}

function StepRow({
  icon: Icon,
  label,
  done,
  active,
  detail,
}: {
  icon: typeof Cpu;
  label: string;
  done: boolean;
  active: boolean;
  detail: string;
}) {
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 rounded-xl transition-all"
      style={{
        background: done
          ? 'var(--color-accent-subtle)'
          : active
            ? 'var(--color-surface)'
            : 'transparent',
        border: active ? '1px solid var(--color-border)' : '1px solid transparent',
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: done ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
          color: done ? 'white' : 'var(--color-text-tertiary)',
        }}
      >
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {label}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)', maxWidth: '280px' }}>
          {done ? t('Готово', 'Ready') : active ? detail : t('Ожидание…', 'Waiting...')}
        </div>
      </div>
      <div className="shrink-0">
        {done ? (
          <CheckCircle2 size={18} style={{ color: 'var(--color-accent)' }} />
        ) : active ? (
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
        ) : (
          <div
            className="w-4 h-4 rounded-full"
            style={{ border: '2px solid var(--color-border)' }}
          />
        )}
      </div>
    </div>
  );
}

export function SetupScreen({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [setupInitiated, setSetupInitiated] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const handedOffRef = useRef(false);
  const poll = useCallback(async () => {
    const s = await getSetupStatus();
    if (s) setStatus(s);
    setStatusChecked(true);
    if (s?.phase === 'ready' && !handedOffRef.current) {
      handedOffRef.current = true;
      // Pre-select a model BEFORE handing off so the chat is usable on
      // first send. Without this, the main app's post-mount fetch can
      // lose a race to a fast first message and Ollama 400s.
      try {
        const preferred = isManagedRemoteSource(s.source)
          ? getInferenceSource().then((config) => config.kind === s.source ? config.model : undefined)
          : fetchRecommendedModel().then(({ model }) => model);
        const [models, preferredModel] = await Promise.all([
          fetchModels().catch(() => []),
          preferred.catch(() => undefined),
        ]);
        const store = useAppStore.getState();
        const override = getSetupModelOverride(models, s.source, preferredModel, store.selectedModel);
        store.setModels(models);
        store.setModelsLoading(false);
        if (override) store.setSelectedModel(override);
      } catch {
        // Non-fatal: store.setModels auto-selects on later fetch, and
        // the InputArea guards the empty-model case with a toast.
      }
      setTimeout(() => onReady(), 600);
    }
  }, [onReady]);

  const changeInferenceSource = useCallback(async () => {
    setRecovering(true);
    setRecoveryError('');
    try {
      await resetInferenceSource();
      handedOffRef.current = false;
      setSetupInitiated(false);
      setStatus(null);
      await poll();
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecovering(false);
    }
  }, [poll]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 800);
    return () => clearInterval(interval);
  }, [poll]);

  if (statusChecked && status?.requires_source && !setupInitiated) {
    return (
      <InferenceSourceSetup
        onStarted={() => {
          setSetupInitiated(true);
          void poll();
        }}
      />
    );
  }

  const activeStep: StepKey | null =
    status && !status.ollama_ready
      ? 'ollama_ready'
      : status && !status.model_ready
        ? 'model_ready'
        : status && !status.server_ready
          ? 'server_ready'
          : null;
  const defaultSteps = getSteps();
  const remote = status && getRemoteSetup()[status.source];
  const steps = remote
    ? [
        { ...defaultSteps[0], detail: remote.engine },
        { ...defaultSteps[1], label: remote.modelLabel ?? defaultSteps[1].label, detail: remote.model },
        defaultSteps[2],
      ]
    : defaultSteps;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="text-center mb-10">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
          >
            <Cpu size={32} />
          </div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>
            OpenJarvis Codex
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {!statusChecked
              ? t('Проверяем сохранённые настройки…', 'Checking your saved setup...')
              : remote?.summary ?? t('Настраиваем локальную модель…', 'Setting up your local AI...')}
          </p>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-2 mb-8">
          {steps.map((step) => (
            <StepRow
              key={step.key}
              icon={step.icon}
              label={step.label}
              done={status?.[step.key] ?? false}
              active={activeStep === step.key}
              detail={
                activeStep === step.key && status?.detail
                  ? localizeSetupDetail(status.detail)
                  : step.detail
              }
            />
          ))}
        </div>

        {/* Error */}
        {status?.error && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm"
            style={{
              background: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)',
              color: 'var(--color-error)',
            }}
          >
            <XCircle size={16} className="shrink-0 mt-0.5" />
            <span style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{status.error}</span>
          </div>
        )}

        {recoveryError && (
          <div
            role="alert"
            className="mt-3 px-4 py-3 rounded-xl text-sm"
            style={{ color: 'var(--color-error)' }}
          >
            {recoveryError}
          </div>
        )}

        {statusChecked && status && !status.requires_source && status.phase !== 'ready' && (
          <InferenceRecoveryButton
            recovering={recovering}
            onChange={() => void changeInferenceSource()}
          />
        )}

        {/* Progress bar */}
        {!status?.error && (
          <div
            className="h-1 rounded-full overflow-hidden"
            style={{ background: 'var(--color-bg-tertiary)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                background: 'var(--color-accent)',
                width: `${
                  ((status?.ollama_ready ? 1 : 0) +
                    (status?.model_ready ? 1 : 0) +
                    (status?.server_ready ? 1 : 0)) *
                  33.33
                }%`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

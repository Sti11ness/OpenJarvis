import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Headphones, Square } from 'lucide-react';
import {
  conversationVoice,
  type ConversationVoiceState,
  type ConversationVoiceUpdate,
} from '../../lib/api';
import { mountNeuralActivity } from '../../lib/neural-activity';
import { useTtsStore } from '../../lib/tts';
import { t } from '../../lib/locale';

type Props = {
  canStart: boolean;
  canSend: boolean;
  thinking: boolean;
  onModeChange(enabled: boolean): void;
  onSpeechStart(): void;
  onUtterance(text: string): void;
};

export function ConversationVoicePanel(props: Props) {
  const [active, setActive] = useState(false);
  const [changing, setChanging] = useState(false);
  const [headphones, setHeadphones] = useState(false);
  const [state, setState] = useState<ConversationVoiceState | null>(null);
  const [error, setError] = useState('');
  const playback = useTtsStore((s) => s.state);
  const voiceLevel = useTtsStore((s) => s.level);
  const speechError = useTtsStore((s) => s.error);
  const playbackBusy = playback !== 'idle';
  const callbacks = useRef(props);
  const writes = useRef(Promise.resolve());
  const mounted = useRef(false);
  const listening = useRef(false);
  const lastStart = useRef(0);
  const lastUtterance = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const visual = useRef<ReturnType<typeof mountNeuralActivity> | null>(null);

  useEffect(() => { callbacks.current = props; }, [props]);

  const update = useCallback((settings: ConversationVoiceUpdate) => {
    const next = writes.current.then(() => conversationVoice(settings));
    writes.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (listening.current) {
        listening.current = false;
        void update({ enabled: false }).catch(() => {});
        useTtsStore.getState().stop();
      }
    };
  }, [update]);

  const toggle = async () => {
    const enabling = !listening.current;
    listening.current = enabling;
    setChanging(true);
    setError('');
    try {
      const reply = await update({ enabled: enabling, headphones, playing: playbackBusy });
      if (!mounted.current) return;
      listening.current = reply.enabled;
      lastStart.current = reply.started;
      lastUtterance.current = 0;
      setState(reply);
      setActive(reply.enabled);
      callbacks.current.onModeChange(reply.enabled);
      if (!enabling) useTtsStore.getState().stop();
    } catch (reason) {
      if (!mounted.current) return;
      listening.current = false;
      setActive(false);
      callbacks.current.onModeChange(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setChanging(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    void update({ headphones, playing: playbackBusy }).catch(() => {});
  }, [active, headphones, playbackBusy, update]);

  useEffect(() => {
    if (!active) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const reply = await conversationVoice();
        if (closed) return;
        setState(reply);
        if (!reply.enabled) {
          listening.current = false;
          setActive(false);
          callbacks.current.onModeChange(false);
          return;
        }
        if (reply.started > lastStart.current) {
          lastStart.current = reply.started;
          callbacks.current.onSpeechStart();
        }
        const utterance = reply.utterance;
        if (utterance && (utterance.id <= lastUtterance.current || callbacks.current.canSend)) {
          if (utterance.id > lastUtterance.current) {
            lastUtterance.current = utterance.id;
            callbacks.current.onUtterance(utterance.text);
          }
          await update({ acknowledge: utterance.id });
        }
      } catch (reason) {
        if (closed) return;
        listening.current = false;
        setActive(false);
        callbacks.current.onModeChange(false);
        setError(reason instanceof Error ? reason.message : String(reason));
        void update({ enabled: false }).catch(() => {});
        return;
      }
      if (!closed) timer = setTimeout(poll, 120);
    };
    void poll();
    return () => { closed = true; clearTimeout(timer); };
  }, [active, update]);

  useEffect(() => {
    if (!active || !canvas.current) return;
    const renderer = mountNeuralActivity(canvas.current);
    visual.current = renderer;
    return () => { renderer.dispose(); visual.current = null; };
  }, [active]);

  const phase = state?.phase === 'recording' ? 'recording'
    : state?.phase === 'transcribing' ? 'transcribing'
    : playback === 'speaking' ? 'speaking'
    : props.thinking || playback === 'loading' ? 'thinking'
    : state?.phase || 'listening';
  const level = phase === 'speaking' ? voiceLevel : state?.level || 0;
  useEffect(() => { visual.current?.update(phase, level); }, [active, phase, level]);

  const titles: Record<string, string> = {
    starting: t('Включаю микрофон', 'Starting the microphone'),
    listening: t('Слушаю', 'Listening'),
    recording: t('Слышу тебя', 'I hear you'),
    transcribing: t('Распознаю речь', 'Transcribing'),
    thinking: t('Готовлю ответ', 'Preparing a reply'),
    speaking: t('Отвечаю', 'Speaking'),
    error: t('Микрофон недоступен', 'Microphone unavailable'),
  };

  const toggleButton = (
    <button
      type="button"
      onClick={() => { void toggle(); }}
      disabled={changing || (!active && !props.canStart)}
      aria-pressed={active}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
    >
      {active ? <Square size={12} /> : <AudioLines size={13} />}
      {active ? t('Завершить разговор', 'End voice chat') : t('Голосовой режим', 'Voice chat')}
    </button>
  );

  if (!active) return (
    <div className="flex flex-wrap items-center gap-2">
      {toggleButton}
      {(error || state?.error) && (
        <span role="status" className="text-xs" style={{ color: 'var(--color-error)' }}>
          {error || state?.error}
        </span>
      )}
    </div>
  );

  return (
    <section
      aria-label={t('Голосовой разговор', 'Voice conversation')}
      className="flex min-w-0 flex-wrap items-center gap-4 rounded-2xl border border-[var(--color-border)] px-4 py-2"
      style={{ background: 'radial-gradient(ellipse at 18% 50%, #132735, var(--color-bg-secondary) 65%)' }}
    >
      <canvas ref={canvas} aria-hidden="true" className="aspect-square w-[min(24vw,172px)] min-w-24 shrink-0" />
      <div className="flex min-w-48 flex-1 flex-col gap-2">
        <div aria-live="polite">
          <p className="text-lg font-semibold leading-tight">{titles[phase] || titles.listening}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {phase === 'speaking' && headphones
              ? t('Начни говорить, чтобы перебить ответ.', 'Start speaking to interrupt.')
              : t('Пауза завершает реплику.', 'A pause ends your turn.')}
          </p>
          {speechError && (
            <p role="status" className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>
              {t('Не удалось озвучить ответ.', 'Could not play the reply.')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {toggleButton}
          <label className="inline-flex items-center gap-1.5 text-xs">
            <Headphones size={14} aria-hidden="true" />
            <input type="checkbox" checked={headphones} onChange={(e) => setHeadphones(e.target.checked)} />
            {t('Наушники', 'Headphones')}
          </label>
          {playbackBusy && (
            <button type="button" className="text-xs" onClick={() => useTtsStore.getState().stop()}>
              {t('Остановить речь', 'Stop speaking')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

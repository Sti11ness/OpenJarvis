// Modified in the personal Jarvis fork.
import { uiLanguage } from '../../lib/locale';

interface Props {
  phase: string;
}

const PHASE_RU: Record<string, string> = {
  'Researching...': 'Исследуем тему…',
  'Generating...': 'Готовим ответ…',
  'Agent thinking...': 'Агент обдумывает запрос…',
};

function displayPhase(phase: string): string {
  if (uiLanguage === 'en') return phase;
  return PHASE_RU[phase] ?? phase
    .replace(/^Searching: (.+)$/, 'Ищем «$1»…')
    .replace(/^Calling (.+)\.\.\.$/, 'Вызываем инструмент $1…');
}

export function StreamingDots({ phase }: Props) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex gap-1">
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--color-text-tertiary)', animationDelay: '0ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--color-text-tertiary)', animationDelay: '150ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--color-text-tertiary)', animationDelay: '300ms' }}
        />
      </div>
      {phase && (
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {displayPhase(phase)}
        </span>
      )}
    </div>
  );
}

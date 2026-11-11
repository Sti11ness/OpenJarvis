// Modified in the personal Jarvis fork.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/store', () => ({ useAppStore: vi.fn() }));

import { MemoryStatusRow } from './SettingsPage';

describe('Settings memory status', () => {
  it('shows the failure detail and a Retry action, then the recovered count', () => {
    const onRetry = vi.fn();
    const failed = renderToStaticMarkup(
      <MemoryStatusRow
        status={{ kind: 'error', message: 'Missing Authorization header (HTTP 401)' }}
        onRetry={onRetry}
      />,
    );
    const recovered = renderToStaticMarkup(
      <MemoryStatusRow
        status={{ kind: 'ready', stats: { backend: 'sqlite', entries: 3 } }}
        onRetry={onRetry}
      />,
    );

    expect(failed).toContain('Missing Authorization header (HTTP 401)');
    expect(failed).toContain('Повторить');
    expect(failed).toContain('Недоступно');
    expect(failed).not.toContain('Unable to reach memory service');
    expect(recovered).toContain('Хранилище sqlite. Записей — 3');
    expect(recovered).not.toContain('Повторить');
    expect(recovered).not.toContain('Missing Authorization header');
  });

  it('does not present an unconfigured backend as connected', () => {
    const html = renderToStaticMarkup(
      <MemoryStatusRow
        status={{ kind: 'ready', stats: { backend: 'none', entries: 0, status: 'not_configured' } }}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('Хранилище памяти не настроено');
    expect(html).toContain('Требуется настройка');
    expect(html).not.toContain('Записей — 0');
  });
});

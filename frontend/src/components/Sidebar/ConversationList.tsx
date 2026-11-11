// Modified in the personal Jarvis fork.
import { Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../lib/store';
import { t, uiLabels, uiLanguage } from '../../lib/locale';

interface Props {
  searchQuery: string;
}

const relativeTime = {
  ru: new Intl.RelativeTimeFormat('ru', { style: 'short' }),
  en: new Intl.RelativeTimeFormat('en', { style: 'short' }),
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('Только что', 'Just now');
  if (minutes < 60) return relativeTime[uiLanguage].format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relativeTime[uiLanguage].format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return relativeTime[uiLanguage].format(-days, 'day');
  return new Date(timestamp).toLocaleDateString(uiLanguage);
}

function displayTitle(title: string): string {
  return title === 'New chat' ? uiLabels.newChat : title;
}

export function ConversationList({ searchQuery }: Props) {
  const navigate = useNavigate();
  const conversations = useAppStore((s) => s.conversations);
  const activeId = useAppStore((s) => s.activeId);
  const streamingConversationId = useAppStore((s) =>
    s.streamState.isStreaming ? s.streamState.conversationId : null,
  );
  const selectConversation = useAppStore((s) => s.selectConversation);
  const deleteConversation = useAppStore((s) => s.deleteConversation);

  const filtered = searchQuery
    ? conversations.filter((c) =>
        displayTitle(c.title).toLocaleLowerCase(uiLanguage).includes(searchQuery.toLocaleLowerCase(uiLanguage)),
      )
    : conversations;

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {searchQuery ? t('Чаты не найдены', 'No matching chats') : t('Здесь появятся ваши чаты', 'No conversations yet')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 py-1">
      {filtered.map((conv) => {
        const isActive = conv.id === activeId;
        const isStreaming = conv.id === streamingConversationId;
        return (
          <div
            key={conv.id}
            className="group flex items-center rounded-lg cursor-pointer transition-colors"
            style={{
              background: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = 'var(--color-bg-secondary)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            <button
              onClick={() => {
                selectConversation(conv.id);
                navigate('/');
              }}
              className="flex-1 text-left px-3 py-2 min-w-0 cursor-pointer"
            >
              <div
                className="text-sm truncate"
                style={{
                  color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {displayTitle(conv.title)}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                {formatRelativeTime(conv.updatedAt)}
              </div>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteConversation(conv.id);
              }}
              disabled={isStreaming}
              className="p-1.5 mr-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={(e) => {
                if (!isStreaming) e.currentTarget.style.color = 'var(--color-error)';
              }}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
              title={
                isStreaming
                  ? t('Остановите ответ, чтобы удалить чат', 'Stop generating before deleting this conversation')
                  : t('Удалить чат', 'Delete conversation')
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

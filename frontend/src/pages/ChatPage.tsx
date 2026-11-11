import { ChatArea } from '../components/Chat/ChatArea';
import { SystemPanel } from '../components/Chat/SystemPanel';
import { useAppStore } from '../lib/store';

export function ChatPage() {
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);
  const [showChat, setShowChat] = useState(false);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0">
        <ChatArea showChat={showChat} onToggleChat={() => setShowChat((value) => !value)} />
      </div>
      {showChat && systemPanelOpen && <SystemPanel />}
    </div>
  );
}
import { useState } from 'react';

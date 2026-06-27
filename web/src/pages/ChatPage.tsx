import { useParams } from 'react-router-dom';
import { ChatPanel } from '../components/ChatPanel';
import { AdminStatsWidget } from '../components/AdminStatsWidget';

export function ChatPage() {
  const { chatId: routeChatId } = useParams();
  return (
    <div className="container">
      <ChatPanel routeChatId={routeChatId} variant="standalone" />
      <AdminStatsWidget />
    </div>
  );
}
import { useParams } from 'react-router-dom';
import { ChatPanel } from '../components/ChatPanel';

export function ChatPage() {
  const { chatId: routeChatId } = useParams();
  return (
    <div className="container">
      <ChatPanel routeChatId={routeChatId} variant="standalone" />
    </div>
  );
}
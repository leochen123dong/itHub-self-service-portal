import { useMemo } from 'react';
import type { ChatMessage as Msg } from '../types/api';

interface Props {
  msg: Msg;
  msgIndex: number;
  onRate?: (msgIndex: number, rating: 'up' | 'down') => void;
}

// Minimal markdown: paragraphs + bold (**x**) + line breaks
function render(content: string) {
  if (!content) return null;
  return content.split(/\n\n+/).map((para, i) => (
    <p key={i} style={{ margin: '0 0 8px' }}>
      {para.split('\n').map((line, j, arr) => (
        <span key={j}>
          {renderInline(line)}
          {j < arr.length - 1 && <br />}
        </span>
      ))}
    </p>
  ));
}

function renderInline(text: string) {
  // **bold**
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push(<strong key={parts.length}>{m[1]}</strong>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function ChatMessage({ msg, msgIndex, onRate }: Props) {
  const isUser = msg.Role === 'User' || msg.Role === 'user';
  const isAssistant = msg.Role === 'Assistant' || msg.Role === 'assistant';
  const body = useMemo(() => render(msg.Content || ''), [msg.Content]);
  const showRate = isAssistant && !!onRate;

  return (
    <div className={`msg msg-${isUser ? 'user' : 'assistant'}`}>
      <div className="msg-avatar">{isUser ? '我' : 'AI'}</div>
      <div className="msg-bubble">
        {body || <em style={{ opacity: .6 }}>（空）</em>}
        {showRate && (
          <div className="msg-rate">
            <button
              type="button"
              className={msg.Rating === 'up' ? 'active' : ''}
              onClick={() => onRate?.(msgIndex, 'up')}
              aria-label="有帮助"
              title="有帮助"
            >
              👍
            </button>
            <button
              type="button"
              className={msg.Rating === 'down' ? 'active' : ''}
              onClick={() => onRate?.(msgIndex, 'down')}
              aria-label="不准确"
              title="不准确"
            >
              👎
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
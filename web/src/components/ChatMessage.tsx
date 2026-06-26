import { useMemo } from 'react';
import type { ChatMessage as Msg } from '../types/api';

interface Props {
  msg: Msg;
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

export function ChatMessage({ msg }: Props) {
  const isUser = msg.Role === 'User' || msg.Role === 'user';
  const body = useMemo(() => render(msg.Content || ''), [msg.Content]);
  return (
    <div className={`msg msg-${isUser ? 'user' : 'assistant'}`}>
      <div className="msg-avatar">{isUser ? '我' : 'AI'}</div>
      <div className="msg-bubble">
        {body || <em style={{ opacity: .6 }}>（空）</em>}
      </div>
    </div>
  );
}
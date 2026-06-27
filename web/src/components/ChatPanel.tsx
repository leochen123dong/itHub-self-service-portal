import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChatStore } from '../store/chatStore';
import { useUiStore } from '../store/uiStore';
import { ChatMessage } from './ChatMessage';
import { SuggestedActions } from './SuggestedActions';
import { Modal } from './Modal';

interface Props {
  // Optional: bind to a specific chatId route param
  routeChatId?: string;
  // Compact variant for embedding in home page
  variant?: 'standalone' | 'embedded';
}

export function ChatPanel({ routeChatId, variant = 'standalone' }: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const toast = useUiStore((s) => s.toast);

  const {
    chatId, chatTitle, messages, suggestions, sending, createdTicketId,
    initChat, loadChat, sendMessage, escalateToTicket, reset,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [autoInitAttempted, setAutoInitAttempted] = useState(false);

  // Load specific chat from route, or auto-init a fresh one
  useEffect(() => {
    if (routeChatId && routeChatId !== chatId) {
      loadChat(routeChatId).catch((e) =>
        toast({ type: 'error', message: '加载对话失败：' + (e?.message || '') }),
      );
    } else if (!routeChatId && !chatId && !autoInitAttempted) {
      setAutoInitAttempted(true);
      initChat('').catch((e) =>
        toast({ type: 'error', message: '启动对话失败：' + (e?.message || '') }),
      );
    }
  }, [routeChatId, chatId, autoInitAttempted, loadChat, initChat, toast]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    try {
      await sendMessage(text);
    } catch (e: any) {
      toast({ type: 'error', message: '发送失败：' + (e?.message || '请重试') });
    }
  };

  const handleEscalate = async () => {
    setEscalateOpen(false);
    try {
      const r = await escalateToTicket();
      if (r?.ticketId) {
        toast({
          type: 'success',
          message: `工单 #${r.ticketId} 已创建`,
          action: { label: '查看工单', href: `/tickets/${r.ticketId}` },
        });
      } else {
        toast({ type: 'error', message: '创建工单失败，请稍后再试' });
      }
    } catch (e: any) {
      toast({ type: 'error', message: '创建工单失败：' + (e?.message || '') });
    }
  };

  const handleNewChat = async () => {
    reset();
    setAutoInitAttempted(false);
    setInput('');
  };

  const showHeader = variant === 'standalone';

  return (
    <>
      {showHeader && (
        <div className="page-header">
          <div>
            <h1 className="page-title">AI 助手</h1>
            <p className="page-subtitle">{chatTitle || '和 AI 聊聊您的 IT 问题'}</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleNewChat}>新对话</button>
        </div>
      )}

      <div className={`chat-container${variant === 'embedded' ? ' chat-container-embedded' : ''}`}>
        {createdTicketId && (
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <div className="chat-banner">
              <span>✅ 本次对话已创建工单 #{createdTicketId}</span>
              <Link to={`/tickets/${createdTicketId}`} className="btn btn-ghost btn-sm">查看 →</Link>
            </div>
          </div>
        )}

        <div className="chat-messages">
          {messages.length === 0 && !sending && (
            <div className="empty">
              <p className="empty-title">👋 你好，我是 IT 助手</p>
              <p>试着问我：我的 VPN 连不上怎么办？ 或者描述你遇到的问题。</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i}>
              <ChatMessage
                msg={m}
                msgIndex={i}
                onRate={(idx, r) => useChatStore.getState().rateMessage(idx, r)}
              />
              {m.Role !== 'User' && m.Role !== 'user' && i === messages.length - 1 && suggestions.length > 0 && (
                <div style={{ marginLeft: 44, marginTop: 6 }}>
                  <SuggestedActions
                    actions={suggestions}
                    onPick={(text) => { setInput(text); }}
                    onEscalate={() => setEscalateOpen(true)}
                  />
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="msg msg-assistant">
              <div className="msg-avatar">AI</div>
              <div className="msg-bubble" style={{ color: 'var(--text-muted)' }}>
                <span className="skeleton" style={{ display: 'inline-block', width: 120, height: 12 }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input">
          <textarea
            className="textarea"
            placeholder="输入您的问题，按 Enter 发送，Shift+Enter 换行"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button className="btn btn-primary" onClick={handleSend} disabled={!input.trim() || sending}>
            发送
          </button>
          <button
            className="btn btn-accent"
            onClick={() => setEscalateOpen(true)}
            disabled={sending || messages.length === 0}
            title="将本次对话转为工单"
          >
            转人工
          </button>
        </div>
      </div>

      <Modal
        open={escalateOpen}
        title="转人工并创建工单"
        confirmText="确认创建"
        confirmVariant="accent"
        onConfirm={handleEscalate}
        onCancel={() => setEscalateOpen(false)}
      >
        <p>系统将把本次对话的关键内容汇总作为工单描述，并分配给服务台坐席处理。</p>
        <p style={{ marginTop: 8 }}>提交后您可以在"我的工单"中跟踪进度。</p>
      </Modal>
    </>
  );
}
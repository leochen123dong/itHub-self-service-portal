import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ticketsApi } from '../api/tickets';
import type { Ticket, TicketJournal } from '../types/api';
import { ApiError } from '../api/client';
import { TicketCard } from '../components/TicketCard';
import { TicketTimeline } from '../components/TicketTimeline';
import { EmptyState } from '../components/EmptyState';
import { KbDraftModal } from '../components/KbDraftModal';
import { useUiStore } from '../store/uiStore';

export function TicketsPage() {
  const { id: routeId } = useParams();
  const toast = useUiStore((s) => s.toast);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<Ticket | null>(null);
  const [journals, setJournals] = useState<TicketJournal[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [kbModalOpen, setKbModalOpen] = useState(false);

  const loadList = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await ticketsApi.list();
      setTickets(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [t, js] = await Promise.all([
        ticketsApi.get(id),
        ticketsApi.journals(id).catch(() => [] as TicketJournal[]),
      ]);
      setDetail(t as Ticket);
      setJournals(Array.isArray(js) ? js : []);
      setLastRefreshed(new Date());
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (routeId) {
      loadDetail(routeId);
      // Poll every 20s while the detail page is open so admin-side edits
      // (assignee, state, journals) propagate without a manual reload.
      const tick = setInterval(() => loadDetail(routeId, true), 20_000);
      return () => clearInterval(tick);
    }
    loadList();
  }, [routeId]);

  const handleAddComment = async () => {
    if (!detail || !comment.trim()) return;
    setSubmitting(true);
    try {
      await ticketsApi.addComment(detail.TicketId, comment.trim());
      setComment('');
      toast({ type: 'success', message: '备注已添加' });
      loadDetail(String(detail.TicketId));
    } catch (e: any) {
      toast({ type: 'error', message: '添加备注失败：' + (e?.message || '') });
    } finally {
      setSubmitting(false);
    }
  };

  if (routeId) {
    if (loading && !detail) {
      return <div className="container"><div className="card"><div className="skeleton" style={{ height: 200 }} /></div></div>;
    }
    if (error) {
      return <div className="container"><div className="card" style={{ color: 'var(--danger)' }}>{error}</div></div>;
    }
    if (!detail) {
      return <div className="container"><EmptyState title="工单不存在" /></div>;
    }
    return (
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">工单 #{detail.TicketId}</h1>
            <p className="page-subtitle">{detail.Summary || '—'}</p>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="field-label">状态</div>
              <span className="tag tag-info">{detail.TicketState || detail.TicketStatus || '新建'}</span>
            </div>
            <div>
              <div className="field-label">优先级</div>
              <span className="tag tag-warning">P{detail.Priority ?? '-'}</span>
            </div>
            <div>
              <div className="field-label">分类</div>
              <div>{detail.Category || detail.TicketCategory?.Name || '—'}</div>
            </div>
            <div>
              <div className="field-label">处理组</div>
              <div>{detail.AssignedUserGroup?.Name || '未分配'}</div>
            </div>
            <div>
              <div className="field-label">处理人</div>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                {detail.AssignedUser?.UserName ? (
                  <>
                    <span
                      className="online-dot"
                      data-online={detail.AssignedUser.IsOnline ? '1' : '0'}
                    />
                    <span style={{ color: detail.AssignedUser.HtmlColor || 'inherit' }}>
                      {detail.AssignedUser.UserName}
                    </span>
                  </>
                ) : (
                  '未分配'
                )}
              </div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>
              {lastRefreshed
                ? `最后同步：${lastRefreshed.toLocaleTimeString('zh-CN', { hour12: false })} · 每 20s 自动刷新`
                : '加载中…'}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => loadDetail(String(detail.TicketId))}
            >
              立即刷新
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">处理记录</h3>
          <TicketTimeline journals={journals} />
          <div className="field" style={{ marginTop: 16 }}>
            <label className="field-label">添加备注</label>
            <textarea
              className="textarea"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="补充说明…"
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button
              className="btn btn-ghost"
              onClick={() => setKbModalOpen(true)}
              disabled={!detail?.TicketId}
              title="AI 总结当前工单生成 KB 草稿"
            >
              生成 KB 草稿
            </button>
            <button
              className="btn btn-primary"
              onClick={handleAddComment}
              disabled={submitting || !comment.trim()}
            >
              {submitting ? '提交中…' : '提交备注'}
            </button>
          </div>
        </div>
        <KbDraftModal
          open={kbModalOpen}
          ticketId={String(detail?.TicketId ?? '')}
          onClose={() => setKbModalOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">我的工单</h1>
          <p className="page-subtitle">查看您的所有工单</p>
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      {loading && <div className="card"><div className="skeleton" style={{ height: 200 }} /></div>}
      {!loading && tickets.length === 0 && (
        <EmptyState title="暂无工单" hint={error || '您还没有提交任何工单'} />
      )}
      {!loading && tickets.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>编号</th>
              <th>主题</th>
              <th>状态</th>
              <th>优先级</th>
              <th>处理组</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => <TicketCard key={t.TicketId} ticket={t} />)}
          </tbody>
        </table>
      )}
    </div>
  );
}
import { useEffect, useState } from 'react';
import { aiApi } from '../api/ai';
import { useUiStore } from '../store/uiStore';

interface Props {
  open: boolean;
  ticketId: number | string;
  onClose: () => void;
}

interface Draft {
  title: string;
  summary: string;
  body: string;
}

interface PublishError {
  code: string;
  message_zh: string;
  upstreamErrors?: Array<{ endpoint: string; status: number; message: string }>;
  draft?: Draft;
}

export function KbDraftModal({ open, ticketId, onClose }: Props) {
  const toast = useUiStore((s) => s.toast);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<PublishError | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await aiApi.kbDraft(ticketId);
      setDraft(d);
    } catch (e: any) {
      setError({
        code: 'KB_DRAFT_FAILED',
        message_zh: e?.message_zh || e?.message || '生成 KB 草稿失败',
      });
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate on open. Skip if we already have a draft cached for this
  // ticket (so reopening doesn't lose edits).
  useEffect(() => {
    if (open && !draft) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const publish = async () => {
    if (!draft || !draft.title.trim()) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await aiApi.kbPublish(draft);
      // Success shape: { articleId, published: true }
      if ('articleId' in res && res.published) {
        toast({ type: 'success', message: `已保存为 KB 草稿 #${res.articleId}` });
        onClose();
        return;
      }
      // Failure shape: { error: { code, message_zh, upstreamErrors, draft } }
      if ('error' in res) {
        setError(res.error as PublishError);
      }
    } catch (e: any) {
      // Network / 5xx — try to parse the upstream error envelope.
      const env = e?.body || e?.data;
      if (env?.error) {
        setError(env.error as PublishError);
      } else {
        setError({
          code: 'KB_PUBLISH_FAILED',
          message_zh: e?.message_zh || e?.message || '发布失败',
        });
      }
    } finally {
      setPublishing(false);
    }
  };

  const copyDraft = async () => {
    const toCopy = error?.draft ?? draft;
    if (!toCopy) return;
    const text = JSON.stringify(toCopy, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast({ type: 'success', message: '草稿已复制到剪贴板' });
    } catch {
      toast({ type: 'error', message: '复制失败，请手动选中复制' });
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">AI 生成 KB 草稿</h3>
        <div className="modal-body">
          {loading && <p className="muted">AI 正在总结工单内容，请稍候…</p>}
          {error && !draft && (
            <div className="error-banner">
              <p>{error.message_zh}</p>
            </div>
          )}
          {draft && (
            <>
              <div className="field">
                <label className="field-label">标题</label>
                <input
                  className="input"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="≤30 字"
                />
              </div>
              <div className="field">
                <label className="field-label">摘要</label>
                <textarea
                  className="textarea"
                  rows={2}
                  value={draft.summary}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  placeholder="≤100 字的一句话总结"
                />
              </div>
              <div className="field">
                <label className="field-label">正文 (Markdown)</label>
                <textarea
                  className="textarea textarea-mono"
                  rows={10}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>
            </>
          )}
          {error && draft && (
            <div className="error-banner">
              <p>
                <strong>发布失败：</strong>
                {error.message_zh}
              </p>
              {error.upstreamErrors && error.upstreamErrors.length > 0 && (
                <details>
                  <summary>上游错误详情 ({error.upstreamErrors.length})</summary>
                  <ul className="error-detail-list">
                    {error.upstreamErrors.map((u, i) => (
                      <li key={i}>
                        <code>{u.endpoint}</code> [{u.status}] {u.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="muted">
                可以把下方草稿复制到剪贴板，然后到 ITHub KB 后台手动粘贴。
              </p>
              <button className="btn btn-secondary btn-sm" onClick={copyDraft}>
                复制草稿到剪贴板
              </button>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-ghost"
            onClick={generate}
            disabled={loading || publishing}
          >
            {loading ? '生成中…' : '重新生成'}
          </button>
          <button
            className="btn btn-primary"
            onClick={publish}
            disabled={!draft || loading || publishing || !draft.title.trim()}
          >
            {publishing ? '保存中…' : '保存为草稿'}
          </button>
        </div>
      </div>
    </div>
  );
}
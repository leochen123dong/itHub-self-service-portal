import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { aiApi } from '../api/ai';
import type { AdminStats } from '../types/api';

function fmtTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Compact AI-rating stats, embedded at the bottom of the chat page for admins
 * only. Keeps the demo surface area small — no separate /admin route.
 */
export function AdminStatsWidget() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!user?.isAdmin) return;
    aiApi
      .getAdminStats()
      .then(setStats)
      .catch((e: any) => setError(e?.message_zh || e?.message || '加载失败'));
  }, [user?.isAdmin]);

  if (!user?.isAdmin) return null;
  if (error) {
    return (
      <div className="admin-widget admin-widget-error">
        评分统计加载失败：{error}
      </div>
    );
  }
  if (!stats) {
    return <div className="admin-widget">加载评分统计…</div>;
  }

  const ratePct = stats.total === 0 ? '—' : `${Math.round(stats.rate * 100)}%`;

  return (
    <details
      className="admin-widget"
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="admin-widget-title">📊 AI 评分统计</span>
        <span className="admin-widget-summary">
          总 {stats.total} · 👍 {stats.up} · 👎 {stats.down} · 接受率 {ratePct}
        </span>
        <span className="admin-widget-hint">{expanded ? '收起' : '展开'}</span>
      </summary>
      <div className="admin-widget-body">
        <div className="admin-stats">
          <div className="stat-card">
            <div className="stat-num">{stats.total}</div>
            <div className="stat-label">总评数</div>
          </div>
          <div className="stat-card stat-good">
            <div className="stat-num">{stats.up}</div>
            <div className="stat-label">👍 有帮助</div>
          </div>
          <div className="stat-card stat-bad">
            <div className="stat-num">{stats.down}</div>
            <div className="stat-label">👎 不准确</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{ratePct}</div>
            <div className="stat-label">接受率</div>
          </div>
        </div>

        <h4>最近 20 条评分</h4>
        {stats.recentRatings.length === 0 ? (
          <p className="admin-widget-muted">暂无评分。</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>时间</th>
                <th style={{ width: 100 }}>用户</th>
                <th style={{ width: 60 }}>评分</th>
                <th>对话 / 消息</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentRatings.map((r, i) => (
                <tr key={i}>
                  <td>{fmtTime(r.at)}</td>
                  <td>{r.userName}</td>
                  <td className={r.rating === 'up' ? 'rate-up' : 'rate-down'}>
                    {r.rating === 'up' ? '👍' : '👎'}
                  </td>
                  <td>
                    <code>{r.chatId.slice(0, 8)}</code> · 第 {r.msgIndex + 1} 条
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {stats.topDown.length > 0 && (
          <>
            <h4>被点踩的回复</h4>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>回复内容（前 120 字）</th>
                  <th style={{ width: 100 }}>用户</th>
                  <th style={{ width: 110 }}>时间</th>
                </tr>
              </thead>
              <tbody>
                {stats.topDown.map((d, i) => (
                  <tr key={i}>
                    <td>{d.content || <em>（内容已被清理）</em>}</td>
                    <td>{d.userName}</td>
                    <td>{fmtTime(d.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <p className="admin-widget-muted">
          数据存储于服务端内存，进程重启后清零。
        </p>
      </div>
    </details>
  );
}
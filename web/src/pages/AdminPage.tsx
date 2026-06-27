import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { aiApi } from '../api/ai';
import { useAuthStore } from '../store/authStore';
import type { AdminStats } from '../types/api';

function fmtTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.isAdmin === false) {
      navigate('/', { replace: true });
      return;
    }
    aiApi
      .getAdminStats()
      .then((r) => setStats(r))
      .catch((e: any) => setError(e?.message_zh || e?.message || '加载失败'));
  }, [user, navigate]);

  if (error) {
    return (
      <div className="page">
        <h2>管理后台</h2>
        <div className="error-banner">{error}</div>
        <p><Link to="/">返回首页</Link></p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="page">
        <h2>管理后台</h2>
        <p>加载中…</p>
      </div>
    );
  }

  const ratePct = stats.total === 0 ? '—' : `${Math.round(stats.rate * 100)}%`;

  return (
    <div className="page admin-page">
      <h2>AI 回复评分统计</h2>
      <p style={{ color: 'var(--text-secondary)' }}>
        数据存储于服务端内存，进程重启后会清零。
      </p>

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

      <h3>最近 20 条评分</h3>
      {stats.recentRatings.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>暂无评分。</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>时间</th>
              <th style={{ width: 100 }}>用户</th>
              <th style={{ width: 80 }}>评分</th>
              <th>对话</th>
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
                  <code>{r.chatId.slice(0, 8)}</code>
                  {' · '}
                  第 {r.msgIndex + 1} 条
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>被点踩的高赞答复</h3>
      {stats.topDown.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>暂无 👎。</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>回复内容（前 120 字）</th>
              <th style={{ width: 120 }}>用户</th>
              <th style={{ width: 140 }}>时间</th>
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
      )}
    </div>
  );
}
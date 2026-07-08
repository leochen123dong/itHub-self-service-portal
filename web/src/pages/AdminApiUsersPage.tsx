import { useEffect, useMemo, useState } from 'react';
import { adminUsersApi, type AdminUserSummary, type DirectorySources } from '../api/adminUsers';
import { ApiError } from '../api/client';
import { useAdminUsersStore } from '../store/adminUsersStore';
import { useUiStore } from '../store/uiStore';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { AdminApiUserDetailDrawer } from './AdminApiUserDetailDrawer';

type Filter = 'all' | 'active' | 'withKey';

export function AdminApiUsersPage() {
  const toast = useUiStore((s) => s.toast);
  const selectedId = useAdminUsersStore((s) => s.selectedId);
  const setSelected = useAdminUsersStore((s) => s.setSelected);
  const manualIdsInput = useAdminUsersStore((s) => s.manualIdsInput);
  const setManualIds = useAdminUsersStore((s) => s.setManualIds);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [sources, setSources] = useState<DirectorySources | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Manual-IDs paste modal state
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    name: '',
    email: '',
    password: '',
  });
  const [creating, setCreating] = useState(false);

  const reload = async (seedIds?: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminUsersApi.list(seedIds ? { seedIds } : undefined);
      setUsers(r.users);
      setSources(r.sources);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload(manualIdsInput || undefined);
    // We only reload when manualIdsInput changes — the reload after a write
    // is triggered explicitly by bumpRefresh from the drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualIdsInput]);

  const filtered = useMemo(() => {
    let r = users;
    if (filter === 'active') r = r.filter((u) => u.Active);
    if (filter === 'withKey') r = r.filter((u) => u.HasApiKey);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (u) =>
          String(u.UserId).includes(q) ||
          (u.Username || '').toLowerCase().includes(q) ||
          (u.Name || '').toLowerCase().includes(q) ||
          (u.Email || '').toLowerCase().includes(q),
      );
    }
    return r;
  }, [users, filter, search]);

  const handlePasteConfirm = () => {
    setManualIds(pasteDraft);
    setPasteOpen(false);
    setPasteDraft('');
  };

  const handleCreate = async () => {
    if (!createForm.username || !createForm.password) {
      toast({ type: 'error', message: '请填写用户名和密码' });
      return;
    }
    setCreating(true);
    try {
      const r = await adminUsersApi.createUser({
        username: createForm.username.trim(),
        name: createForm.name.trim() || undefined,
        email: createForm.email.trim() || undefined,
        password: createForm.password,
      });
      toast({
        type: 'success',
        message: `用户 ${createForm.username} 已创建 (ID=${r.userId})`,
      });
      setCreateOpen(false);
      setCreateForm({ username: '', name: '', email: '', password: '' });
      await reload(manualIdsInput || undefined);
    } catch (e) {
      toast({
        type: 'error',
        message: '创建失败：' + (e instanceof ApiError ? e.message : ''),
      });
    } finally {
      setCreating(false);
    }
  };

  const onDrawerClose = () => {
    setSelected(null);
    // After any write in the drawer, it calls bumpRefresh — we refetch here.
    reload(manualIdsInput || undefined);
  };

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">API 使用管理</h1>
          <p className="page-subtitle">
            管理租户内所有用户的 API Key、权限白名单与生命周期
            {sources && (
              <>
                {' '}
                · 共 {users.length} 个用户（来源：
                groups {sources.fromGroups} / seed {sources.fromSeed} / manual{' '}
                {sources.fromManual}）
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setPasteDraft(manualIdsInput);
              setPasteOpen(true);
            }}
          >
            粘贴 ID 列表
          </button>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            + 新建用户
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="搜索 ID / 用户名 / 邮箱"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={filter === 'active'}
              onChange={(e) => setFilter(e.target.checked ? 'active' : 'all')}
            />
            仅活跃
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={filter === 'withKey'}
              onChange={(e) => setFilter(e.target.checked ? 'withKey' : 'all')}
            />
            仅持 Key
          </label>
          {manualIdsInput && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              已粘贴 ID: {manualIdsInput}
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className="card">
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title="未查询到用户"
          hint={
            users.length === 0
              ? 'ITHub UserGroups 未返回成员，且无粘贴的 ID。请点击「粘贴 ID 列表」补充。'
              : '当前过滤条件下没有匹配的用户。'
          }
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>用户名</th>
                <th>邮箱</th>
                <th style={{ width: 80 }}>状态</th>
                <th style={{ width: 80 }}>API Key</th>
                <th style={{ width: 90 }}>AllowAll</th>
                <th style={{ width: 100 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr
                  key={u.UserId}
                  onClick={() => setSelected(u.UserId)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{u.UserId}</td>
                  <td>
                    {u.Username || u.Name || `用户 #${u.UserId}`}
                    {u._unresolved && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          color: 'var(--text-muted)',
                        }}
                      >
                        (未解析)
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {u.Email || '—'}
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 11,
                        background: u.Active ? '#dcfce7' : '#fee2e2',
                        color: u.Active ? '#15803d' : '#b91c1c',
                      }}
                    >
                      {u.Active ? '活跃' : '停用'}
                    </span>
                  </td>
                  <td>
                    {u.HasApiKey ? (
                      u.ApiKeyActive ? (
                        <span style={{ color: 'var(--accent)', fontSize: 12 }}>● 有</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          ● 禁用
                        </span>
                      )
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    {u.IsAllowAll ? (
                      <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(u.UserId);
                      }}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      <AdminApiUserDetailDrawer userId={selectedId} onClose={onDrawerClose} />

      {/* Paste-IDs modal */}
      <Modal
        open={pasteOpen}
        title="粘贴用户 ID 列表"
        onConfirm={handlePasteConfirm}
        onCancel={() => setPasteOpen(false)}
        confirmText="应用"
      >
        <p style={{ fontSize: 13, marginBottom: 8 }}>
          ITHub 不暴露用户列表端点。粘贴 ID（逗号或换行分隔）后点击「应用」：
        </p>
        <textarea
          className="input"
          rows={4}
          style={{ width: '100%', fontFamily: 'monospace' }}
          placeholder="例如：138, 96078, 97315"
          value={pasteDraft}
          onChange={(e) => setPasteDraft(e.target.value)}
        />
      </Modal>

      {/* Create-user modal */}
      <Modal
        open={createOpen}
        title="新建用户"
        onConfirm={handleCreate}
        onCancel={() => setCreateOpen(false)}
        confirmText={creating ? '创建中…' : '创建'}
        confirmVariant="primary"
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            用户名 *
            <input
              className="input"
              style={{ width: '100%' }}
              value={createForm.username}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, username: e.target.value }))
              }
            />
          </label>
          <label style={{ fontSize: 13 }}>
            显示名
            <input
              className="input"
              style={{ width: '100%' }}
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            邮箱
            <input
              className="input"
              style={{ width: '100%' }}
              value={createForm.email}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </label>
          <label style={{ fontSize: 13 }}>
            初始密码 *
            <input
              className="input"
              type="password"
              style={{ width: '100%' }}
              value={createForm.password}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, password: e.target.value }))
              }
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
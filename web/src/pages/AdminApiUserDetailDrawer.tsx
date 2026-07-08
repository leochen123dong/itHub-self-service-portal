import { useEffect, useState } from 'react';
import { adminUsersApi, type AdminUserDetail, type AuditEvent, type UsageSummary } from '../api/adminUsers';
import { ApiError } from '../api/client';
import { Drawer } from '../components/Drawer';
import { Modal } from '../components/Modal';
import { useAdminUsersStore, type AdminUserTab } from '../store/adminUsersStore';
import { useUiStore } from '../store/uiStore';
import type { UserGroup } from '../types/api';

interface Props {
  userId: number | null;
  onClose: () => void;
}

const TABS: { key: AdminUserTab; label: string }[] = [
  { key: 'permissions', label: '权限' },
  { key: 'apiKey', label: 'API Key' },
  { key: 'lifecycle', label: '生命周期' },
  { key: 'usage', label: '使用' },
  { key: 'audit', label: '审计' },
];

const ALLOW_ALL_FLAG = 0x7fffffff;

export function AdminApiUserDetailDrawer({ userId, onClose }: Props) {
  const toast = useUiStore((s) => s.toast);
  const openTab = useAdminUsersStore((s) => s.openTab);
  const setTab = useAdminUsersStore((s) => s.setTab);
  const refreshTick = useAdminUsersStore((s) => s.refreshTick);
  const bumpRefresh = useAdminUsersStore((s) => s.bumpRefresh);

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Permissions tab state
  const [allowAllDirty, setAllowAllDirty] = useState(false);
  const [allowAllLocal, setAllowAllLocal] = useState(false);
  const [savingPerm, setSavingPerm] = useState(false);

  // API Key tab state
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [revokingKey, setRevokingKey] = useState(false);

  // Lifecycle tab state
  const [allGroups, setAllGroups] = useState<UserGroup[]>([]);
  const [activeLocal, setActiveLocal] = useState(true);
  const [groupIdsLocal, setGroupIdsLocal] = useState<Set<number>>(new Set());
  const [lifecycleDirty, setLifecycleDirty] = useState(false);
  const [savingLifecycle, setSavingLifecycle] = useState(false);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // Usage tab state
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Audit tab state
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditDegraded, setAuditDegraded] = useState(false);
  const [auditReason, setAuditReason] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadUser = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const u = await adminUsersApi.get(userId);
      setUser(u);
      setAllowAllLocal(u.IsAllowAll);
      setActiveLocal(u.Active);
      setGroupIdsLocal(new Set(u.UserGroupIds || []));
      setAllowAllDirty(false);
      setLifecycleDirty(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载用户详情失败');
    } finally {
      setLoading(false);
    }
  };

  const loadUsage = async () => {
    if (!userId) return;
    setUsageLoading(true);
    try {
      const r = await adminUsersApi.usageSummary(userId);
      setUsage(r);
    } catch (e) {
      // Silent — usage is best-effort.
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  };

  const loadAudit = async () => {
    if (!userId) return;
    setAuditLoading(true);
    try {
      const r = await adminUsersApi.audit(userId);
      setAuditEvents(r.events);
      setAuditDegraded(!!r.degraded);
      setAuditReason(r.reason ?? null);
    } catch (e) {
      setAuditEvents([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      const r = await adminUsersApi.getUserGroups();
      setAllGroups(r.groups || []);
    } catch {
      setAllGroups([]);
    }
  };

  // Reload user when drawer opens or refresh ticks (post-write).
  useEffect(() => {
    if (userId) {
      loadUser();
      loadGroups();
    } else {
      setUser(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshTick]);

  // Tab-driven lazy loads
  useEffect(() => {
    if (!userId || !user) return;
    if (openTab === 'usage' && !usage && !usageLoading) loadUsage();
    if (openTab === 'audit' && auditEvents.length === 0 && !auditLoading) loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTab, userId, user]);

  const handleSavePermissions = async () => {
    if (!userId) return;
    setSavingPerm(true);
    try {
      const flags = allowAllLocal ? ALLOW_ALL_FLAG : 0;
      await adminUsersApi.updatePermissions(userId, flags);
      toast({ type: 'success', message: '权限已更新' });
      bumpRefresh();
    } catch (e) {
      toast({
        type: 'error',
        message: '更新失败：' + (e instanceof ApiError ? e.message : ''),
      });
    } finally {
      setSavingPerm(false);
    }
  };

  const handleCreateKey = async () => {
    if (!userId) return;
    setCreatingKey(true);
    try {
      const r = await adminUsersApi.createApiKey(userId);
      setNewKey(r.apiKey);
      setKeyModalOpen(true);
      bumpRefresh();
    } catch (e) {
      toast({
        type: 'error',
        message: '生成失败：' + (e instanceof ApiError ? e.message : ''),
      });
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!userId) return;
    setRevokingKey(true);
    try {
      await adminUsersApi.revokeApiKey(userId);
      toast({ type: 'success', message: 'API Key 已撤销' });
      setConfirmRevoke(false);
      bumpRefresh();
    } catch (e) {
      toast({
        type: 'error',
        message: '撤销失败：' + (e instanceof ApiError ? e.message : ''),
      });
    } finally {
      setRevokingKey(false);
    }
  };

  const handleSaveLifecycle = async () => {
    if (!userId) return;
    setSavingLifecycle(true);
    try {
      await adminUsersApi.updateLifecycle(userId, {
        active: activeLocal,
        userGroupIds: [...groupIdsLocal],
      });
      toast({ type: 'success', message: '生命周期已更新' });
      bumpRefresh();
    } catch (e) {
      toast({
        type: 'error',
        message: '更新失败：' + (e instanceof ApiError ? e.message : ''),
      });
    } finally {
      setSavingLifecycle(false);
    }
  };

  const handleResetPassword = async () => {
    if (!userId || !newPassword) return;
    try {
      await adminUsersApi.resetPassword(userId, newPassword);
      // Backend returns 501, but ApiError will surface the message either way.
    } catch (e) {
      // Expected — show the upstream message.
      toast({
        type: 'info',
        message: e instanceof ApiError ? e.message : '请到 ITHub 后台重置密码',
      });
    } finally {
      setResetPwdOpen(false);
      setNewPassword('');
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      toast({ type: 'success', message: '已复制到剪贴板' });
    } catch {
      toast({ type: 'error', message: '复制失败，请手动选中复制' });
    }
  };

  const toggleGroup = (id: number) => {
    setGroupIdsLocal((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Drawer
        title={user ? `用户 #${user.UserId} · ${user.Username || user.Name}` : '用户详情'}
        open={!!userId}
        onClose={onClose}
      >
        {error && (
          <div className="card" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {loading && <div className="skeleton" style={{ height: 120 }} />}
        {!loading && user && (
          <>
            {/* Tab bar */}
            <div className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab${openTab === t.key ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Permissions tab */}
            {openTab === 'permissions' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allowAllLocal}
                    onChange={(e) => {
                      setAllowAllLocal(e.target.checked);
                      setAllowAllDirty(true);
                    }}
                  />
                  允许全部 API 方法 (UserAccessFlags = 0x7FFFFFFF)
                </label>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  当前 flags: <code>{user.UserAccessFlags}</code>
                </div>
                <div style={{ fontSize: 13 }}>
                  细分位：
                  {user.FlagBreakdown && user.FlagBreakdown.length > 0 ? (
                    <ul style={{ margin: '6px 0 0 18px' }}>
                      {user.FlagBreakdown.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>（无）</span>
                  )}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleSavePermissions}
                  disabled={!allowAllDirty || savingPerm}
                >
                  {savingPerm ? '保存中…' : '保存权限'}
                </button>
              </div>
            )}

            {/* API Key tab */}
            {openTab === 'apiKey' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div>
                  状态：
                  {user.HasApiKey ? (
                    user.ApiKeyActive ? (
                      <span style={{ color: 'var(--accent)' }}>● 已激活</span>
                    ) : (
                      <span style={{ color: 'var(--danger)' }}>● 已禁用</span>
                    )
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>— 无 Key</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleCreateKey}
                    disabled={creatingKey}
                  >
                    {creatingKey ? '生成中…' : '生成新 Key'}
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => setConfirmRevoke(true)}
                    disabled={!user.HasApiKey || revokingKey}
                  >
                    {revokingKey ? '撤销中…' : '撤销 Key'}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  生成新 Key 后旧 Key 将立即失效。Key 仅在生成时显示一次，请妥善保存。
                </p>
              </div>
            )}

            {/* Lifecycle tab */}
            {openTab === 'lifecycle' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={activeLocal}
                    onChange={(e) => {
                      setActiveLocal(e.target.checked);
                      setLifecycleDirty(true);
                    }}
                  />
                  启用
                </label>
                <div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>用户组：</div>
                  {allGroups.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      加载用户组失败
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {allGroups.map((g) => (
                        <label
                          key={g.UserGroupId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={groupIdsLocal.has(g.UserGroupId)}
                            onChange={() => {
                              toggleGroup(g.UserGroupId);
                              setLifecycleDirty(true);
                            }}
                          />
                          {g.Name || `组 #${g.UserGroupId}`}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveLifecycle}
                    disabled={!lifecycleDirty || savingLifecycle}
                  >
                    {savingLifecycle ? '保存中…' : '保存生命周期'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setResetPwdOpen(true)}
                  >
                    重置密码
                  </button>
                </div>
              </div>
            )}

            {/* Usage tab */}
            {openTab === 'usage' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  本地使用统计（数据来自 <code>POST /usage/log</code> 手动导入）
                </p>
                {usageLoading && <div className="skeleton" style={{ height: 80 }} />}
                {!usageLoading && usage && (
                  <>
                    {usage.rows.length === 0 ? (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        暂无调用记录
                      </div>
                    ) : (
                      usage.rows.map((r) => (
                        <div
                          key={r.userId}
                          className="card"
                          style={{ padding: 12 }}
                        >
                          <div style={{ fontSize: 13 }}>
                            调用 {r.calls} 次 · 错误 {r.errors} 次 ·
                            错误率 {(r.errorRate * 100).toFixed(1)}%
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            最近活跃：
                            {r.lastActiveAt
                              ? new Date(r.lastActiveAt).toLocaleString()
                              : '—'}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            )}

            {/* Audit tab */}
            {openTab === 'audit' && (
              <div style={{ display: 'grid', gap: 12 }}>
                {auditDegraded && (
                  <div
                    className="card"
                    style={{
                      padding: 12,
                      background: '#fef3c7',
                      color: '#92400e',
                      fontSize: 13,
                    }}
                  >
                    ⚠ {auditReason || 'ITHub 审计端点不可用，以下为本地记录'}
                  </div>
                )}
                {auditLoading && <div className="skeleton" style={{ height: 80 }} />}
                {!auditLoading && auditEvents.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    暂无审计事件
                  </div>
                )}
                {!auditLoading &&
                  auditEvents.map((e) => (
                    <div
                      key={e.id}
                      className="card"
                      style={{ padding: 12, fontSize: 13 }}
                    >
                      <div style={{ fontWeight: 500 }}>
                        {e.action}
                        {e.detail && (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {' '}— {e.detail}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        by {e.actor} · 用户 #{e.userId} ·{' '}
                        {new Date(e.ts).toLocaleString()}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* New-key one-shot modal */}
      <Modal
        open={keyModalOpen}
        title="新 API Key（仅显示一次）"
        onConfirm={() => {
          setKeyModalOpen(false);
          setNewKey(null);
        }}
        onCancel={() => {
          setKeyModalOpen(false);
          setNewKey(null);
        }}
        confirmText="我已保存"
        cancelText="关闭"
      >
        <p style={{ fontSize: 13, marginBottom: 8 }}>
          请立即复制并妥善保存，关闭后无法再次查看：
        </p>
        <div
          style={{
            background: 'var(--bg-muted)',
            padding: 12,
            borderRadius: 6,
            fontFamily: 'monospace',
            fontSize: 14,
            wordBreak: 'break-all',
            marginBottom: 8,
          }}
        >
          {newKey}
        </div>
        <button className="btn btn-secondary" onClick={copyKey}>
          复制
        </button>
      </Modal>

      {/* Revoke confirmation */}
      <Modal
        open={confirmRevoke}
        title="撤销 API Key？"
        onConfirm={handleRevokeKey}
        onCancel={() => setConfirmRevoke(false)}
        confirmText={revokingKey ? '撤销中…' : '撤销'}
        confirmVariant="danger"
      >
        <p style={{ fontSize: 13 }}>
          撤销后该用户的 API Key 立即失效，相关集成将无法调用。无法撤销，请谨慎操作。
        </p>
      </Modal>

      {/* Reset-password modal */}
      <Modal
        open={resetPwdOpen}
        title="重置密码"
        onConfirm={handleResetPassword}
        onCancel={() => {
          setResetPwdOpen(false);
          setNewPassword('');
        }}
        confirmText="提交"
      >
        <p style={{ fontSize: 13, marginBottom: 8 }}>
          提示：ITHub 后台密码重置端点暂未在 API 中暴露，此操作会记录到审计但不会真正修改密码。
        </p>
        <input
          className="input"
          style={{ width: '100%' }}
          type="password"
          placeholder="新密码"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Modal>
    </>
  );
}
import { useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { UserGroup } from '../types/api';
import { ApiError } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { useUiStore } from '../store/uiStore';

export function AdminVipPage() {
  const toast = useUiStore((s) => s.toast);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  // Selected ids as a Set for O(1) toggle on checkbox change.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Initial load — pull every ITHub user group + the current VIP selection.
  useEffect(() => {
    const load = async () => {
      try {
        const r = await adminApi.getUserGroups();
        setGroups(r.groups || []);
        setSelected(new Set((r.vipGroupIds || []).map(Number)));
      } catch (e: any) {
        setError(e instanceof ApiError ? e.message : '加载用户组失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminApi.setVipGroups([...selected]);
      toast({ type: 'success', message: 'VIP 用户组已保存' });
    } catch (e: any) {
      toast({
        type: 'error',
        message: '保存失败：' + (e instanceof ApiError ? e.message : e?.message || ''),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">VIP 设置</h1>
          <p className="page-subtitle">
            勾选需要优先处置的 ITHub 用户组，命中组的客户工单会显示橙色 VIP 标识
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || loading}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}

      {loading && (
        <div className="card"><div className="skeleton" style={{ height: 200 }} /></div>
      )}

      {!loading && !error && groups.length === 0 && (
        <EmptyState title="未查询到用户组" hint="请确认 ITHub 中存在可访问的用户组" />
      )}

      {!loading && groups.length > 0 && (
        <div className="card">
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
            已选 {selected.size} / {groups.length} 个组
          </div>
          <div className="vip-group-list">
            {groups.map((g) => (
              <label key={g.UserGroupId} className="vip-group-item">
                <input
                  type="checkbox"
                  checked={selected.has(g.UserGroupId)}
                  onChange={() => toggle(g.UserGroupId)}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>{g.Name || `用户组 #${g.UserGroupId}`}</span>
                  {g.Description && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {g.Description}
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

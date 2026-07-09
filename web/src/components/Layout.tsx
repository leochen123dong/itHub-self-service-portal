import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { authApi } from '../api/auth';

// Visual design: dark topnav (matches Leo's "IT 智能客服" reference).
// Each tab routes to an existing page; "coming soon" items still render
// (disabled) so the nav structure mirrors the reference exactly.
const NAV_ITEMS: Array<{ key: string; label: string; to?: string; disabled?: boolean }> = [
  { key: 'home', label: '首页', to: '/' },
  { key: 'templates', label: '模板管理', to: '/catalog' },
  { key: 'profile', label: '个人中心', to: '/tickets' },
  { key: 'audit', label: '审计日志', to: '/admin/api-users', disabled: !isAdminGate() },
  { key: 'session-audit', label: '会话审计', disabled: true },
  { key: 'config', label: '系统配置', to: '/admin/vip' },
  { key: 'feature', label: '选贤集', disabled: true },
  { key: 'more', label: '…', disabled: true },
];

// Cheap "is current user admin" check that doesn't trigger re-render. We
// just expose the same key the auth store uses. Per-tab guards in
// adminUsers routes still enforce server-side; this is purely a UI hint.
function isAdminGate(): boolean {
  try {
    const raw = localStorage.getItem('auth-storage');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!parsed?.state?.user?.isAdmin;
  } catch {
    return false;
  }
}

export function Layout() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const logout = useAuthStore((s) => s.logout);
  const hydrate = useAuthStore((s) => s.hydrate);
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();

  const initial = user?.userName?.[0]?.toUpperCase() || user?.identity?.[0]?.toUpperCase() || '?';
  const isAdmin = !!user?.isAdmin;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Periodic re-hydrate so we catch backend session death quickly (default
  // backend session TTL is 8h, but the user's ITHub AccessToken can expire
  // much sooner). When hydrate() throws, authStore sets status='guest' and
  // RequireAuth redirects to /login on the next render. Every 60s is
  // frequent enough to be useful and sparse enough to be invisible.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (status !== 'authed') return;
    const id = window.setInterval(() => {
      hydrate().catch(() => {
        // hydrate() itself catches and updates state — nothing to do here.
      });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [status, hydrate]);

  // Listen for 401 events fired by api/client.ts. The server now retries
  // ITHub calls once after refreshing the demo session, so a 401 reaching
  // us is most likely real permission denial, not stale token. Show the
  // message as a toast; user can decide whether to log out manually.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      toast({
        type: 'error',
        message:
          detail?.message ||
          '请求失败 (401)。如果反复出现，请点击右上角「退出」重新登录以刷新 AccessToken。',
      });
    };
    window.addEventListener('ithub:api-error-401', handler);
    return () => window.removeEventListener('ithub:api-error-401', handler);
  }, [toast]);

  // Filter disabled items at render time. Audit tab is only enabled for admins.
  const visibleItems = NAV_ITEMS.filter((it) => {
    if (it.key === 'audit' && !isAdmin) return false;
    return true;
  });

  return (
    <nav className="topnav topnav-dark">
      <div className="topnav-logo">
        <span className="topnav-logo-icon topnav-logo-icon-dark">I</span>
        <span>ITHub 智能服务门户</span>
      </div>
      <div className="topnav-tabs">
        {visibleItems.map((it) => {
          if (it.disabled || !it.to) {
            return (
              <span
                key={it.key}
                className="topnav-tab topnav-tab-disabled"
                title="即将推出"
                aria-disabled="true"
              >
                {it.label}
              </span>
            );
          }
          return (
            <NavLink
              key={it.key}
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}
            >
              {it.label}
            </NavLink>
          );
        })}
      </div>
      <div className="topnav-user topnav-user-dark">
        <span className="topnav-lang" title="切换语言">🌐 中文</span>
        <span className="user-avatar user-avatar-dark">{initial}</span>
        <span className="topnav-username">
          {user?.userName || user?.identity}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
          退出
        </button>
      </div>
    </nav>
  );
}
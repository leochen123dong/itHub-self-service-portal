import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { authApi } from '../api/auth';

export function Layout() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const logout = useAuthStore((s) => s.logout);
  const hydrate = useAuthStore((s) => s.hydrate);
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();

  const initial = user?.userName?.[0]?.toUpperCase() || user?.identity?.[0]?.toUpperCase() || '?';

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

  return (
    <nav className="topnav">
      <div className="topnav-logo">
        <span className="topnav-logo-icon">I</span>
        <span>ITHub 智能服务门户</span>
      </div>
      <div className="topnav-tabs">
        <NavLink to="/" end className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}>
          首页
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}>
          AI助手
        </NavLink>
        <NavLink to="/kb" className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}>
          知识库
        </NavLink>
        <NavLink to="/catalog" className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}>
          服务目录
        </NavLink>
        <NavLink to="/tickets" className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}>
          我的工单
        </NavLink>
        <NavLink to="/admin/vip" className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}>
          VIP 设置
        </NavLink>
        {user?.isAdmin && (
          <NavLink to="/admin/api-users" className={({ isActive }) => `topnav-tab${isActive ? ' active' : ''}`}>
            API 使用管理
          </NavLink>
        )}
      </div>
      <div className="topnav-user">
        <span className="user-avatar">{initial}</span>
        <span>{user?.userName || user?.identity}</span>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout}>退出</button>
      </div>
    </nav>
  );
}
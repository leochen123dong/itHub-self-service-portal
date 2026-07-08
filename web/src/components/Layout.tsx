import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

export function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const toast = useUiStore((s) => s.toast);
  const navigate = useNavigate();

  const initial = user?.userName?.[0]?.toUpperCase() || user?.identity?.[0]?.toUpperCase() || '?';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Listen for session-expiry events from api/client.ts. When the backend
  // returns 401 on a non-auth endpoint, fire a single toast per minute
  // prompting the user to log back in. Layout is mounted for every
  // authenticated page so this catches 401s from anywhere in the app.
  useEffect(() => {
    const handler = () => {
      toast({
        type: 'error',
        message: '会话已过期，请重新登录',
        action: { label: '去登录', href: '/login' },
      });
    };
    window.addEventListener('ithub:session-expired', handler);
    return () => window.removeEventListener('ithub:session-expired', handler);
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
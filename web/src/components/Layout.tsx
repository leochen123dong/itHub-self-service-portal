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

  // Listen for 401 events fired by api/client.ts. We deliberately do NOT
  // auto-logout or auto-navigate here: a 401 may simply mean ITHub denied
  // a write operation (e.g. ticket creation rejected for permission), in
  // which case kicking the user back to /login just makes the situation
  // worse. The toast in client.ts already shows the error; the user can
  // choose to log out manually via the top-right button if they need a
  // fresh AccessToken.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      toast({
        type: 'error',
        message:
          detail?.message ||
          '请求失败 (401)。如果是创建/写入操作被拒，可能是 ITHub 权限或会话需要刷新。',
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
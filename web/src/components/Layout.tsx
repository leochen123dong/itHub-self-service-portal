import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const initial = user?.userName?.[0]?.toUpperCase() || user?.identity?.[0]?.toUpperCase() || '?';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

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
      </div>
      <div className="topnav-user">
        <span className="user-avatar">{initial}</span>
        <span>{user?.userName || user?.identity}</span>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout}>退出</button>
      </div>
    </nav>
  );
}
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';

export function LoginPage() {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);
  const status = useAuthStore((s) => s.status);
  const navigate = useNavigate();

  // Prefill demo identity if .env has it
  useEffect(() => {
    authApi.demoHint().then((h) => {
      if (h.identity) setIdentity(h.identity);
    }).catch(() => {});
    if (status === 'authed') navigate('/', { replace: true });
  }, [status, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identity, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">ITHub 智能服务门户</h1>
        <p className="login-subtitle">登录以开始您的 IT 自助服务</p>
        <div className="field">
          <label className="field-label">账号 / 邮箱</label>
          <input
            className="input"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder="demo.user"
            autoFocus
          />
        </div>
        <div className="field">
          <label className="field-label">密码</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
          disabled={submitting || !identity || !password}
        >
          {submitting ? '登录中…' : '登录'}
        </button>
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          Demo 模式 · 由后端代理隐藏真实凭证
        </div>
      </form>
    </div>
  );
}
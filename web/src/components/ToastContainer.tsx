import { Link } from 'react-router-dom';
import { useUiStore } from '../store/uiStore';

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const remove = useUiStore((s) => s.removeToast);

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span style={{ flex: 1 }}>{t.message}</span>
          {t.action && (
            <Link to={t.action.href} onClick={() => remove(t.id)} className="btn btn-ghost btn-sm">
              {t.action.label}
            </Link>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => remove(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
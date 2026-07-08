import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useUiStore } from './store/uiStore';

import { Layout } from './components/Layout';
import { ToastContainer } from './components/ToastContainer';

import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { ChatPage } from './pages/ChatPage';
import { KbPage } from './pages/KbPage';
import { CatalogPage } from './pages/CatalogPage';
import { TicketsPage } from './pages/TicketsPage';
import { AdminVipPage } from './pages/AdminVipPage';
import { AdminApiUsersPage } from './pages/AdminApiUsersPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <div className="container"><div className="skeleton" style={{height: 200}} /></div>;
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const status = useAuthStore((s) => s.status);

  useEffect(() => { hydrate(); }, [hydrate]);

  return (
    <div className="app">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <Layout />
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/chat/:chatId" element={<ChatPage />} />
                <Route path="/kb" element={<KbPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/catalog/:id" element={<CatalogPage />} />
                <Route path="/tickets" element={<TicketsPage />} />
                <Route path="/tickets/:id" element={<TicketsPage />} />
                <Route path="/admin/vip" element={<AdminVipPage />} />
                <Route path="/admin/api-users" element={<AdminApiUsersPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RequireAuth>
          }
        />
      </Routes>
      {status !== 'loading' && <ToastContainer />}
    </div>
  );
}
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { catalogApi } from '../api/catalog';
import { ticketsApi } from '../api/tickets';
import type { TicketTemplate, TicketTemplateConfig } from '../types/api';
import { ApiError } from '../api/client';
import { TicketForm } from '../components/TicketForm';
import { EmptyState } from '../components/EmptyState';
import { useUiStore } from '../store/uiStore';

export function CatalogPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.toast);

  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [selected, setSelected] = useState<TicketTemplate | null>(null);
  const [config, setConfig] = useState<TicketTemplateConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await catalogApi.list();
      setTemplates(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : '加载服务目录失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTemplate = async (id: number | string) => {
    setLoading(true);
    setError(null);
    try {
      const [t, cfg] = await Promise.all([
        catalogApi.list().catch(() => []),
        catalogApi.getConfig(id),
      ]);
      const found = (t as TicketTemplate[]).find((x) => String(x.TicketTemplateId) === String(id));
      setSelected(found || ({ TicketTemplateId: Number(id) } as TicketTemplate));
      setConfig(cfg as TicketTemplateConfig);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : '加载模板失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (routeId) loadTemplate(routeId);
    else loadList();
  }, [routeId]);

  const handleSubmit = async (values: Record<string, any>) => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const payload = {
        TicketTemplateId: selected.TicketTemplateId,
        ...values,
      };
      const r = await ticketsApi.create(payload);
      const ticketId = r?.TicketId ?? r?.ticketId ?? r?.Id;
      toast({
        type: 'success',
        message: `服务请求已提交${ticketId ? `，工单 #${ticketId}` : ''}`,
        action: ticketId ? { label: '查看', href: `/tickets/${ticketId}` } : undefined,
      });
      navigate('/tickets');
    } catch (e: any) {
      toast({ type: 'error', message: '提交失败：' + (e?.message || '') });
    } finally {
      setSubmitting(false);
    }
  };

  if (routeId) {
    return (
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">{selected?.Name || `服务模板 #${routeId}`}</h1>
            <p className="page-subtitle">{selected?.Description || '填写表单提交服务请求'}</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate('/catalog')}>返回目录</button>
        </div>
        {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
        {loading && <div className="card"><div className="skeleton" style={{ height: 200 }} /></div>}
        {!loading && config && (
          <div className="card">
            <TicketForm config={config} onSubmit={handleSubmit} submitting={submitting} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">服务目录</h1>
          <p className="page-subtitle">选择一个服务提交请求</p>
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      {loading && <div className="card"><div className="skeleton" style={{ height: 200 }} /></div>}
      {!loading && templates.length === 0 && (
        <EmptyState title="暂无服务模板" hint={error || '请检查租户配置'} />
      )}
      {!loading && templates.length > 0 && (
        <div className="grid-cards">
          {templates.map((t) => (
            <div
              key={t.TicketTemplateId}
              className="tile"
              onClick={() => navigate(`/catalog/${t.TicketTemplateId}`)}
            >
              <div className="tile-icon">🛎️</div>
              <h3 className="tile-title">{t.Name || `模板 #${t.TicketTemplateId}`}</h3>
              <p className="tile-desc">{t.Description || t.Summary || '点击查看详情'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
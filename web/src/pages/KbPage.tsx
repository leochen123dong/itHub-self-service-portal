import { useEffect, useState } from 'react';
import { kbApi } from '../api/kb';
import type { KnowledgeArticle } from '../types/api';
import { ApiError } from '../api/client';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { decodeHtmlEntities } from '../utils/text';

// 构建时间戳 —— 每次重新构建会刷新这个常量，让 Vite 输出的 bundle
// content-hash 跟着变。这样 GH Pages 部署后用户的浏览器一定拿新
// bundle（而不是吃上一版的缓存）。在 console 输出一行，方便确认
// 浏览器实际加载的是哪个版本。
const BUILD_STAMP = '2026-06-30-refresh-v3';
if (typeof console !== 'undefined') {
  console.info('[ITHub Portal] build:', BUILD_STAMP);
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

// ITHub sometimes returns rich sub-context / user objects instead of a
// plain string for fields like KnowledgeCategoryName / CreatedBy /
// ModifiedBy (varies per tenant / per article). React error #31
// ("Objects are not valid as a React child") fires when we render those
// directly. Coerce defensively.
function safeStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Object: pull .Name if present (matches ITHub's user / category shape),
  // otherwise JSON. Avoid React error #31 by always returning a string.
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.Name === 'string') return o.Name;
    if (typeof o.UserName === 'string') return o.UserName;
    if (typeof o.DisplayName === 'string') return o.DisplayName;
    return '';
  }
  return String(v);
}

// ITHub status codes → human-readable Chinese label + CSS modifier.
// 0=Draft, 1=Open/Pending (we use this for created articles), 2=Published.
// Anything else falls through to "未知".
const STATUS_LABELS: Record<number, { label: string; cls: string }> = {
  0: { label: '草稿', cls: 'draft' },
  1: { label: '待发布', cls: 'pending' },
  2: { label: '已发布', cls: 'published' },
};

function KbVersionInfo({ article }: { article: KnowledgeArticle }) {
  const status = typeof article.KnowledgeArticleStatus === 'number'
    ? STATUS_LABELS[article.KnowledgeArticleStatus]
    : null;
  const createdBy = safeStr(article.CreatedBy);
  const modifiedBy = safeStr(article.ModifiedBy);
  const category = safeStr(article.KnowledgeCategoryName);
  const version = typeof article.Version === 'number' ? article.Version : 0;
  return (
    <div className="kb-version-info">
      <div className="kb-version-cell">
        <span className="kb-version-label">创建时间</span>
        <span className="kb-version-value">{formatDate(safeStr(article.CreatedUtc)) || '—'}</span>
        {createdBy && <span className="kb-version-author">by {createdBy}</span>}
      </div>
      <div className="kb-version-cell">
        <span className="kb-version-label">最后更新</span>
        <span className="kb-version-value">{formatDate(safeStr(article.ModifiedUtc)) || '—'}</span>
        {modifiedBy && <span className="kb-version-author">by {modifiedBy}</span>}
      </div>
      <div className="kb-version-cell">
        <span className="kb-version-label">版本</span>
        <span className="kb-version-badge">v{version}</span>
      </div>
      {status && (
        <div className="kb-version-cell">
          <span className="kb-version-label">状态</span>
          <span className={`kb-version-status ${status.cls}`}>{status.label}</span>
        </div>
      )}
      {category && (
        <div className="kb-version-cell">
          <span className="kb-version-label">分类</span>
          <span className="kb-version-value">{category}</span>
        </div>
      )}
    </div>
  );
}

export function KbPage() {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [results, setResults] = useState<KnowledgeArticle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [openArticle, setOpenArticle] = useState<KnowledgeArticle | null>(null);
  const [openArticleRefreshing, setOpenArticleRefreshing] = useState(false);
  const [refreshingList, setRefreshingList] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArticles = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await kbApi.listArticles();
      setArticles(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadArticles(); }, []);

  const handleSearch = async () => {
    if (!query.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const r = await kbApi.search(query, 10);
      setResults(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  };

  // 每次点开一篇文章都重新拉一遍 ——
  // 因为 ITHub admin 端可能已经改了状态/分类/正文，本地 list 缓存
  // 落后 3-5+s 是常态。所以即使同一篇文章也要重新拉详情，确保
  // Drawer 看到的是 ITHub 最新值（openKbArticle 里再 fetch 一次）
  const refreshList = async () => {
    setRefreshingList(true);
    try {
      const r = await kbApi.listArticles();
      setArticles(Array.isArray(r) ? r : []);
    } catch {
      // 静默失败 —— 列表刷新不影响查看
    } finally {
      setRefreshingList(false);
    }
  };

  const fetchArticleById = async (id: number | string): Promise<KnowledgeArticle | null> => {
    try {
      return await kbApi.getArticle(id);
    } catch {
      return (results || articles).find((x) => String(x.KnowledgeArticleId) === String(id)) ?? null;
    }
  };

  const openKbArticle = async (id: number | string) => {
    // 先清空状态，再拉新数据 —— 这样即使用户连续点同一篇文章，
    // React 也会触发"setOpenArticle(null) → setOpenArticle(...)"两次
    // 重渲染，组件彻底刷新；同时 Loading 态可见。
    setOpenArticle(null);
    const a = await fetchArticleById(id);
    if (a) setOpenArticle(a);
  };

  const refreshOpenArticle = async () => {
    if (!openArticle) return;
    setOpenArticleRefreshing(true);
    try {
      const a = await fetchArticleById(openArticle.KnowledgeArticleId);
      if (a) setOpenArticle(a);
    } finally {
      setOpenArticleRefreshing(false);
    }
  };

  const list = results ?? articles;

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">知识库</h1>
          <p className="page-subtitle">搜索或浏览常见 IT 问题及解决方案</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="搜索知识库文章…（语义搜索）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading}>
            {loading ? '搜索中…' : '搜索'}
          </button>
          {results && (
            <button className="btn btn-secondary" onClick={() => { setResults(null); setQuery(''); }}>
              清除
            </button>
          )}
          {!results && (
            <button
              className="btn btn-secondary"
              onClick={refreshList}
              disabled={refreshingList}
              title="从 ITHub 重新拉一次列表"
            >
              {refreshingList ? '刷新中…' : '刷新列表'}
            </button>
          )}
        </div>
        {error && <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </div>

      {loading && (
        <div className="card">
          <div className="skeleton" style={{ height: 16, width: '60%', marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 16, width: '80%' }} />
        </div>
      )}

      {!loading && list.length === 0 && (
        <EmptyState title="暂无文章" hint={error ? error : '请检查 KB_ID 配置或先在系统中创建一些文章'} />
      )}

      {!loading && list.length > 0 && (
        <div>
          {list.map((a) => (
            <div
              key={a.KnowledgeArticleId}
              className="kb-result"
              onClick={() => openKbArticle(a.KnowledgeArticleId)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h4 className="kb-result-title" style={{ margin: 0, flex: 1 }}>
                  {safeStr(a.Title) || safeStr(a.Name) || safeStr(a.Summary) || `文章 #${a.KnowledgeArticleId}`}
                </h4>
                {typeof a.Version === 'number' && a.Version > 0 && (
                  <span className="kb-version-badge-sm">v{a.Version}</span>
                )}
              </div>
              <p className="kb-result-snippet">
                {safeStr(a.Summary || a.Description).slice(0, 200) || '（无摘要）'}
              </p>
            </div>
          ))}
        </div>
      )}

      <Drawer
        title={
          safeStr(openArticle?.Title) ||
          safeStr(openArticle?.Name) ||
          safeStr(openArticle?.Summary) ||
          (openArticle ? `文章 #${openArticle.KnowledgeArticleId}` : '文章')
        }
        open={!!openArticle}
        onClose={() => setOpenArticle(null)}
        headerActions={
          openArticle ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={refreshOpenArticle}
              disabled={openArticleRefreshing}
              title="从 ITHub 重新拉一次详情"
            >
              {openArticleRefreshing ? '刷新中…' : '刷新'}
            </button>
          ) : null
        }
      >
        {openArticle ? <KbVersionInfo article={openArticle} /> : (
          <div className="skeleton" style={{ height: 64 }} />
        )}
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, marginTop: 16 }}>
          {(() => {
            const raw = safeStr(
              openArticle?.Content || openArticle?.Body || openArticle?.Description,
            );
            if (!raw) return '（正文为空）';
            return decodeHtmlEntities(raw);
          })()}
        </div>
      </Drawer>
    </div>
  );
}
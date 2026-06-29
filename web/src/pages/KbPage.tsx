import { useEffect, useState } from 'react';
import { kbApi } from '../api/kb';
import type { KnowledgeArticle } from '../types/api';
import { ApiError } from '../api/client';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { decodeHtmlEntities } from '../utils/text';

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
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
  return (
    <div className="kb-version-info">
      <div className="kb-version-cell">
        <span className="kb-version-label">创建时间</span>
        <span className="kb-version-value">{formatDate(article.CreatedUtc) || '—'}</span>
        {article.CreatedBy && (
          <span className="kb-version-author">by {article.CreatedBy}</span>
        )}
      </div>
      <div className="kb-version-cell">
        <span className="kb-version-label">最后更新</span>
        <span className="kb-version-value">{formatDate(article.ModifiedUtc) || '—'}</span>
        {article.ModifiedBy && (
          <span className="kb-version-author">by {article.ModifiedBy}</span>
        )}
      </div>
      {status && (
        <div className="kb-version-cell">
          <span className="kb-version-label">状态</span>
          <span className={`kb-version-status ${status.cls}`}>{status.label}</span>
        </div>
      )}
      {article.KnowledgeCategoryName && (
        <div className="kb-version-cell">
          <span className="kb-version-label">分类</span>
          <span className="kb-version-value">{article.KnowledgeCategoryName}</span>
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

  const openKbArticle = async (id: number | string) => {
    try {
      const a = await kbApi.getArticle(id);
      setOpenArticle(a);
    } catch {
      // fall back to what we have
      const cached = (results || articles).find((x) => String(x.KnowledgeArticleId) === String(id));
      if (cached) setOpenArticle(cached);
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
              <h4 className="kb-result-title">
                {a.Title || a.Name || a.Summary || `文章 #${a.KnowledgeArticleId}`}
              </h4>
              <p className="kb-result-snippet">
                {(a.Summary || a.Description || '').slice(0, 200) || '（无摘要）'}
              </p>
            </div>
          ))}
        </div>
      )}

      <Drawer
        title={
          openArticle?.Title ||
          openArticle?.Name ||
          openArticle?.Summary ||
          (openArticle ? `文章 #${openArticle.KnowledgeArticleId}` : '文章')
        }
        open={!!openArticle}
        onClose={() => setOpenArticle(null)}
      >
        {openArticle && <KbVersionInfo article={openArticle} />}
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, marginTop: 16 }}>
          {(() => {
            const raw =
              openArticle?.Content || openArticle?.Body || openArticle?.Description || '';
            if (!raw) return '（正文为空）';
            return decodeHtmlEntities(raw);
          })()}
        </div>
      </Drawer>
    </div>
  );
}
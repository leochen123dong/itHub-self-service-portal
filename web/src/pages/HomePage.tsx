import { Link } from 'react-router-dom';
import { ChatPanel } from '../components/ChatPanel';

const quickLinks = [
  {
    to: '/kb',
    icon: '📚',
    title: '知识库',
    desc: '搜索常见 IT 问题',
  },
  {
    to: '/catalog',
    icon: '🛠️',
    title: '服务目录',
    desc: '提交服务请求',
  },
  {
    to: '/tickets',
    icon: '📋',
    title: '我的工单',
    desc: '查看进度与备注',
  },
];

export function HomePage() {
  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">欢迎使用 ITHub 智能服务门户</h1>
          <p className="page-subtitle">直接描述您的 IT 问题，AI 助手会即时回答；解决不了时可一键转人工开单</p>
        </div>
      </div>

      <ChatPanel variant="embedded" />

      <div style={{ marginTop: 24 }}>
        <div className="section-title">其他入口</div>
        <div className="quick-links">
          {quickLinks.map((q) => (
            <Link key={q.to} to={q.to} className="quick-link">
              <span className="quick-link-icon">{q.icon}</span>
              <span className="quick-link-body">
                <span className="quick-link-title">{q.title}</span>
                <span className="quick-link-desc">{q.desc}</span>
              </span>
              <span className="quick-link-arrow">→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
import { Link } from 'react-router-dom';

const tiles = [
  {
    to: '/chat',
    icon: '🤖',
    title: 'AI 助手',
    desc: '向 AI 提问，秒级获得答案或知识库文章',
  },
  {
    to: '/kb',
    icon: '📚',
    title: '知识库',
    desc: '浏览和搜索常见 IT 问题及解决方案',
  },
  {
    to: '/catalog',
    icon: '🛠️',
    title: '服务目录',
    desc: '提交服务请求，例如申请新设备、申请权限',
  },
  {
    to: '/tickets',
    icon: '📋',
    title: '我的工单',
    desc: '查看工单进度、时间线，并补充备注',
  },
];

export function HomePage() {
  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-title">欢迎使用 ITHub 智能服务门户</h1>
          <p className="page-subtitle">在这里您可以自助解决大部分 IT 问题，未解决时可一键转人工</p>
        </div>
      </div>
      <div className="grid-cards">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="tile">
            <div className="tile-icon">{t.icon}</div>
            <h3 className="tile-title">{t.title}</h3>
            <p className="tile-desc">{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
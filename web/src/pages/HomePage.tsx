import { Link } from 'react-router-dom';

// Two-up yellow CTA layout (matches the "IT 智能客服" reference image).
// Each card routes to existing functionality:
//   - 故障报修/服务申请 → /catalog (服务目录 — 选模板提工单)
//   - 在线坐席 → /chat (AI 助手 — 含转人工按钮)
const ctas = [
  {
    to: '/catalog',
    title: '故障报修/服务申请',
    desc: '提交设备故障、服务申请及问题咨询',
  },
  {
    to: '/chat',
    title: '在线坐席',
    desc: 'AI智能客服及人工在线坐席',
  },
];

export function HomePage() {
  return (
    <div className="home-2col">
      <h1 className="home-title">欢迎使用IT智能客服</h1>

      <div className="home-cta-row">
        {ctas.map((c) => (
          <Link key={c.to} to={c.to} className="home-cta-card">
            <div className="home-cta-title">{c.title}</div>
            <div className="home-cta-desc">{c.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
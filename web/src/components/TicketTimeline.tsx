import type { TicketJournal } from '../types/api';

interface Props {
  journals: TicketJournal[];
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function TicketTimeline({ journals }: Props) {
  if (!journals?.length) {
    return <div className="empty"><p>暂无记录</p></div>;
  }
  return (
    <div className="timeline">
      {journals.map((j, i) => (
        <div className="timeline-item" key={j.TicketJournalId ?? i}>
          <div className="timeline-dot" />
          <div className="timeline-time">
            {formatDate(j.CreatedLocalTime || j.CreatedUtc)} · {j.UserName || '系统'}
            {j.TicketJournalType !== undefined && (
              <span style={{ marginLeft: 8 }} className="tag tag-neutral">
                {typeof j.TicketJournalType === 'number' ? `类型 ${j.TicketJournalType}` : j.TicketJournalType}
              </span>
            )}
          </div>
          <div className="timeline-content">{j.Content || ''}</div>
        </div>
      ))}
    </div>
  );
}
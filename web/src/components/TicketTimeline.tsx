import type { TicketJournal } from '../types/api';
import { stripHtml } from '../utils/text';

interface Props {
  journals: TicketJournal[];
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function pickBody(j: TicketJournal): string {
  // ITHub canonical: Html. Defensive: fall back to Content in case the
  // upstream shape changes.
  const raw = j.Html ?? j.Content ?? '';
  return stripHtml(raw);
}

function pickAuthor(j: TicketJournal): string {
  return (
    j.CreatedBy?.Name ||
    j.CreatedBy?.UserName ||
    j.ModifiedBy?.Name ||
    j.ModifiedBy?.UserName ||
    j.UserName ||
    '系统'
  );
}

function pickTime(j: TicketJournal): string | undefined {
  return j.CreatedLocalTime || j.CreatedUtc || j.ModifiedLocalTime || j.ModifiedUtc;
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
            {formatDate(pickTime(j))} · {pickAuthor(j)}
            {j.TicketJournalType !== undefined && (
              <span style={{ marginLeft: 8 }} className="tag tag-neutral">
                {typeof j.TicketJournalType === 'number' ? `类型 ${j.TicketJournalType}` : j.TicketJournalType}
              </span>
            )}
          </div>
          <div className="timeline-content">{pickBody(j)}</div>
        </div>
      ))}
    </div>
  );
}
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

// ITHub returns journals with the body in `Html` (wrapped in <p>...</p>),
// plus double-encoded entities (`&lt;` etc.). The old field map only read
// `Content` and `UserName`, so the timeline rendered empty.
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // ITHub sends Unicode as hex entities (e.g. &#x5B89;). Decode both forms.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
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
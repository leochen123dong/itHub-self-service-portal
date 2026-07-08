import { Link } from 'react-router-dom';
import type { Ticket } from '../types/api';

interface Props {
  ticket: Ticket;
}

function stateTag(state?: string | number, status?: string | number) {
  const s = (state ?? status ?? '').toString().toLowerCase();
  if (s.includes('closed') || s.includes('resolved')) return 'tag-success';
  if (s.includes('progress') || s.includes('active') || s.includes('assigned')) return 'tag-info';
  if (s.includes('pending') || s.includes('suspend')) return 'tag-warning';
  if (s.includes('new')) return 'tag-neutral';
  return 'tag-neutral';
}

function priorityTag(p?: number) {
  if (!p) return 'tag-neutral';
  if (p <= 2) return 'tag-danger';
  if (p === 3) return 'tag-warning';
  return 'tag-neutral';
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function TicketCard({ ticket }: Props) {
  return (
    <tr>
      <td>
        <Link to={`/tickets/${ticket.TicketId}`} style={{ fontWeight: 600 }}>
          #{ticket.TicketId}
        </Link>
        {ticket.IsVip && (
          <span
            className="vip-badge"
            title={`VIP 用户组：${(ticket.VipUserGroups || []).join('、') || '已标记'}`}
          >
            VIP
          </span>
        )}
      </td>
      <td>{ticket.Summary || '—'}</td>
      <td>
        <span className={`tag ${stateTag(ticket.TicketState, ticket.TicketStatus)}`}>
          {ticket.TicketState || ticket.TicketStatus || '新建'}
        </span>
      </td>
      <td>
        <span className={`tag ${priorityTag(ticket.Priority)}`}>
          P{ticket.Priority ?? '-'}
        </span>
      </td>
      <td>{ticket.AssignedUserGroup?.Name || '—'}</td>
      <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        {formatDate(ticket.CreatedLocalTime || ticket.CreatedUtc)}
      </td>
    </tr>
  );
}
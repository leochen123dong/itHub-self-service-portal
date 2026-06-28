import { api } from './client';
import type { Ticket, TicketJournal } from '../types/api';

export const ticketsApi = {
  list: (offset = 0, count = 50) =>
    api.get<Ticket[]>(`/tickets?offset=${offset}&count=${count}`),
  get: (id: number | string) => api.get<Ticket>(`/tickets/${id}`),
  journals: (id: number | string) => api.get<TicketJournal[]>(`/tickets/${id}/journals`),
  byCheckPoint: (checkPoint: string) =>
    api.post<any>('/tickets/by-checkpoint', { checkPoint }),
  create: (payload: any) => api.post<any>('/tickets', payload),
  // Atomic AI-chat → ticket pipeline: creates the ticket AND posts the chat
  // transcript as a journal so it appears in ITHub's Service Desk Journals
  // view. Server returns the created ticket plus journalPosted flag.
  escalate: (payload: {
    templateId: number;
    ticketType?: number;
    summary: string;
    description?: string;
    chatTranscript: string;
  }) =>
    api.post<any & { journalPosted?: boolean; journalError?: string }>(
      '/tickets/escalate',
      payload,
    ),
  update: (id: number | string, payload: any) => api.put(`/tickets/${id}`, payload),
  // Add a comment to a ticket. Server auto-transitions the ticket out of
  // the "Registered" state if needed (ITHub rejects journal creation on
  // Registered tickets with TicketInRegisteredStatusException).
  addComment: (id: number | string, content: string) =>
    api.post(`/tickets/${id}/journals`, { content }),
};
import { api } from './client';
import type { TicketTemplate, TicketTemplateMenu, TicketTemplateConfig } from '../types/api';

export const catalogApi = {
  list: () => api.get<TicketTemplate[]>('/catalog'),
  get: (id: number | string) => api.get<TicketTemplate>(`/catalog/${id}`),
  getMenu: (id: number | string) => api.get<TicketTemplateMenu>(`/catalog/${id}/menu`),
  getConfig: (id: number | string) => api.get<TicketTemplateConfig>(`/catalog/${id}/config`),
};
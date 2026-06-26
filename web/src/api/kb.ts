import { api } from './client';
import type { KnowledgeArticle } from '../types/api';

export const kbApi = {
  listArticles: () => api.get<KnowledgeArticle[]>('/kb/articles'),
  getArticle: (id: number | string) => api.get<KnowledgeArticle>(`/kb/articles/${id}`),
  search: (query: string, topK: number = 10) =>
    api.post<KnowledgeArticle[]>('/kb/search', { query, topK }),
};
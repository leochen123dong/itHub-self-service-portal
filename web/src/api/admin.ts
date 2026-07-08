import { api } from './client';
import type { UserGroup } from '../types/api';

export const adminApi = {
  // Returns the union of ITHub user groups we've actually seen attached
  // to any customer we've looked up via /Security/Users/{id}. Cold-start:
  // if the registry is empty the backend does a one-shot warm-up by
  // listing the first 50 tickets and resolving each unique customer.
  getObservedGroups: () =>
    api.get<{ groups: UserGroup[]; vipGroupIds: number[] }>('/admin/observed-groups'),
  setVipGroups: (groupIds: number[]) =>
    api.post<{ vipGroupIds: number[] }>('/admin/vip-groups', { groupIds }),
};

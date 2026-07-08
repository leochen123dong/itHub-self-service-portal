import { api } from './client';
import type { UserGroup } from '../types/api';

export const adminApi = {
  getUserGroups: () =>
    api.get<{ groups: UserGroup[]; vipGroupIds: number[] }>('/admin/user-groups'),
  setVipGroups: (groupIds: number[]) =>
    api.post<{ vipGroupIds: number[] }>('/admin/vip-groups', { groupIds }),
};

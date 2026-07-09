import { create } from 'zustand';

export type AdminUserTab =
  | 'permissions'
  | 'apiKey'
  | 'lifecycle'
  | 'usage'
  | 'audit'
  | 'apiUsage';

interface AdminUsersState {
  selectedId: number | null;
  openTab: AdminUserTab;
  manualIdsInput: string;
  // Bump to force the detail drawer to refetch from server after writes.
  refreshTick: number;

  setSelected: (id: number | null) => void;
  setTab: (t: AdminUserTab) => void;
  setManualIds: (s: string) => void;
  bumpRefresh: () => void;
}

// Why a store: only the cross-component bits live here — which user is
// selected, which tab is active, what's pasted into the manual-IDs input.
// List-level concerns (filter values, sort) stay as useState inside the
// page component to avoid global pollution.
export const useAdminUsersStore = create<AdminUsersState>((set) => ({
  selectedId: null,
  openTab: 'permissions',
  manualIdsInput: '',
  refreshTick: 0,
  setSelected: (id) => set({ selectedId: id, openTab: 'permissions', refreshTick: 0 }),
  setTab: (openTab) => set({ openTab }),
  setManualIds: (s) => set({ manualIdsInput: s }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
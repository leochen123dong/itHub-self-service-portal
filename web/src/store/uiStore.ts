import { create } from 'zustand';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  action?: { label: string; href: string };
}

interface UiState {
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  removeToast: (id: number) => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  toast: (t) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, ...t }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((x) => x.id !== id) });
    }, 6000);
  },
  removeToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));
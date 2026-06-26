import type { ReactNode } from 'react';

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ title, open, onClose, children }: Props) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-header">
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>关闭</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
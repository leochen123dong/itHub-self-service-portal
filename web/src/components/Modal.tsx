import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'accent' | 'danger';
}

export function Modal({
  open,
  title,
  children,
  onConfirm,
  onCancel,
  confirmText = '确认',
  cancelText = '取消',
  confirmVariant = 'primary',
}: Props) {
  if (!open) return null;
  const cls = `btn btn-${confirmVariant}`;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelText}</button>
          <button className={cls} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
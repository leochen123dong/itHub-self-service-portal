import type { SuggestedAction } from '../types/api';

interface Props {
  actions: SuggestedAction[];
  onPick: (text: string) => void;
  onEscalate?: () => void;
}

export function SuggestedActions({ actions, onPick, onEscalate }: Props) {
  if (!actions?.length && !onEscalate) return null;
  return (
    <div className="suggested-actions">
      {actions?.map((a, i) => (
        <button key={i} className="suggested-chip" onClick={() => onPick(a.Text)}>
          {a.Text}
        </button>
      ))}
      {onEscalate && (
        <button
          className="suggested-chip"
          style={{ background: 'var(--brand-accent-light)', color: 'var(--brand-accent)' }}
          onClick={onEscalate}
        >
          转人工 →
        </button>
      )}
    </div>
  );
}
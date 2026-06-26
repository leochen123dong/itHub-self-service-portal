import { useState } from 'react';
import type { TicketTemplateConfig } from '../types/api';

interface Props {
  config: TicketTemplateConfig;
  onSubmit: (values: Record<string, any>) => void;
  submitting?: boolean;
}

// Render a TicketTemplateConfig into a form.
// We try to be flexible: handle the most common field shapes.
export function TicketForm({ config, onSubmit, submitting }: Props) {
  const [values, setValues] = useState<Record<string, any>>({});

  // Try several common keys to find the form definitions
  const defs =
    config.TicketPropertyDefinitions ||
    config.UserInputFormConfig?.Fields ||
    config.Fields ||
    [];

  const update = (key: string, v: any) => setValues({ ...values, [key]: v });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  if (!Array.isArray(defs) || defs.length === 0) {
    return (
      <div className="empty">
        <p>该服务模板未配置表单字段。请直接提交。</p>
        <button className="btn btn-primary" disabled={submitting} onClick={() => onSubmit({})}>
          {submitting ? '提交中…' : '提交'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="col">
      {defs.map((def: any, i: number) => {
        const key = def.Name || def.PropertyName || def.Key || `field_${i}`;
        const label = def.DisplayName || def.Label || def.Name || `字段 ${i + 1}`;
        const type = (def.Type || def.FieldType || 'text').toString().toLowerCase();
        const required = !!def.Required || def.IsRequired;
        return (
          <div className="field" key={key}>
            <label className="field-label">
              {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
            </label>
            {renderField(type, key, values[key], (v) => update(key, v), def)}
            {def.Description && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {def.Description}
              </div>
            )}
          </div>
        );
      })}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? '提交中…' : '提交服务请求'}
        </button>
      </div>
    </form>
  );
}

function renderField(type: string, key: string, value: any, onChange: (v: any) => void, def: any) {
  if (type.includes('select') || type === 'dropdown') {
    const options: any[] = def.Options || def.Values || [];
    return (
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">请选择</option>
        {options.map((o: any, i: number) => {
          const ov = typeof o === 'object' ? (o.Value ?? o.value ?? o.Id ?? o.Id) : o;
          const ot = typeof o === 'object' ? (o.Text ?? o.text ?? o.Name ?? o.DisplayName ?? ov) : o;
          return <option key={i} value={ov}>{String(ot)}</option>;
        })}
      </select>
    );
  }
  if (type.includes('multi')) {
    return <div className="field-label" style={{ fontStyle: 'italic' }}>（多选字段，请联系管理员配置）</div>;
  }
  if (type.includes('check')) {
    return (
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>是</span>
      </label>
    );
  }
  if (type.includes('text') && type.includes('area') || type === 'textarea' || type === 'multiline') {
    return (
      <textarea
        className="textarea"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (type.includes('date')) {
    return (
      <input
        className="input"
        type="datetime-local"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className="input"
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
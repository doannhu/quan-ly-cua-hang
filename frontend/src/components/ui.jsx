import { useState, useCallback } from 'react';
import { CheckIcon } from './icons.jsx';

// iOS-style alert. Usage: const [dialog, ask] = useDialog(); ask({title, message, input?, actions})
export function useDialog() {
  const [state, setState] = useState(null);
  const close = useCallback(() => setState(null), []);
  const node = state && <Alert {...state} close={close} />;
  return [node, setState];
}

function Alert({ title, message, input, actions, close }) {
  const [value, setValue] = useState(input?.value || '');
  const run = (a) => {
    close();
    a.onClick?.(value);
  };
  return (
    <div className="backdrop" onClick={close}>
      <div className="alert" role="alertdialog" onClick={(e) => e.stopPropagation()}>
        <div className="alert-body">
          <h3>{title}</h3>
          {message && <p>{message}</p>}
          {input && (
            <input
              autoFocus
              type={input.type || 'text'}
              placeholder={input.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
        <div className="alert-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              className={a.style || ''}
              onClick={() => run(a)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, children }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-value">{children}</div>
    </div>
  );
}

export const SHIFTS = [
  { value: 1, label: 'Ca 1' },
  { value: 2, label: 'Ca 2' },
  { value: 3, label: 'Giao ca 1-2' },
];
export const shiftLabel = (v) => SHIFTS.find((s) => s.value === v)?.label || `Ca ${v}`;

// Badge colours for big counters (quầy lớn): white text on a solid background, contrast ≥ 4.5:1 in light
// and dark mode. Green, orange and red are left out on purpose: they mean "đã đếm / chưa đếm / thiếu".
const COUNTER_COLORS = [
  '#0a63c9', // blue
  '#8e3fb5', // purple
  '#c2185b', // pink
  '#0b7285', // teal
  '#4b47c4', // indigo
  '#8a6a46', // brown
  '#56636f', // slate
  '#22409a', // navy
  '#7a2e5c', // plum
];
// bigCounterId -> colour, numbered per store in creation order: a newly added counter takes the next colour
// and existing counters keep theirs.
export function counterColors(stores) {
  const map = new Map();
  for (const s of stores || []) {
    const byAge = [...s.bigCounters].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    byAge.forEach((b, i) => map.set(b.id, COUNTER_COLORS[i % COUNTER_COLORS.length]));
  }
  return (bigId) => {
    if (map.has(bigId)) return map.get(bigId);
    // counter no longer in the catalog (deleted): stable colour from its id
    let h = 0;
    for (const ch of String(bigId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COUNTER_COLORS[h % COUNTER_COLORS.length];
  };
}
// Right-pointing iOS disclosure chevron; `open` rotates it to point down (for expandable rows).
export const Chevron = ({ open }) => (
  <svg className={`chevron${open ? ' open' : ''}`} width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6" /></svg>
);

export function CounterBadge({ color, children }) {
  return <span className="counter-badge" style={{ background: color }}>{children}</span>;
}

export const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
export const fmtDate = (iso) => iso.split('-').reverse().join('/');

// iOS-style picker: a row that opens a bottom sheet list with a checkmark on the selected item.
// `stacked`: label on the first line, chosen value on a second line (for long labels/values).
// `sheetTitle`: plain-text title for the sheet when `label` is JSX.
export function Picker({ label, value, options, onChange, placeholder = 'Chọn…', disabled, clearLabel, stacked, sheetTitle }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const pick = (v) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <>
      {stacked ? (
        <button type="button" className="row picker stacked" disabled={disabled} onClick={() => setOpen(true)}>
          <span className="stacked-text">
            <span className="stacked-label">{label}</span>
            <span className={`stacked-value ${current ? '' : 'placeholder'}`}>{current ? `→ ${current.label}` : placeholder}</span>
          </span>
          <Chevron />
        </button>
      ) : (
        <button type="button" className="row picker" disabled={disabled} onClick={() => setOpen(true)}>
          <span className="row-label">{label}</span>
          <span className={`picker-value ${current ? '' : 'placeholder'}`}>
            {current ? current.label : placeholder}
            <Chevron />
          </span>
        </button>
      )}
      {open && (
        <div className="backdrop sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <h3>{sheetTitle || label}</h3>
              <button className="btn link" onClick={() => setOpen(false)}>Đóng</button>
            </div>
            <div className="sheet-list group">
              {clearLabel && (
                <button className="sheet-item" onClick={() => pick('')}>
                  <span>{clearLabel}</span>{!value && <CheckIcon size={20} />}
                </button>
              )}
              {options.map((o) => (
                <button key={o.value} className="sheet-item" onClick={() => pick(o.value)}>
                  <span>{o.label}</span>{o.value === value && <CheckIcon size={20} />}
                </button>
              ))}
              {!options.length && <p className="muted center pad">Chưa có dữ liệu</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

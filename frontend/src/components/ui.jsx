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

export const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
export const fmtDate = (iso) => iso.split('-').reverse().join('/');

// iOS-style picker: a row that opens a bottom sheet list with a checkmark on the selected item.
export function Picker({ label, value, options, onChange, placeholder = 'Chọn…', disabled, clearLabel }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const pick = (v) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <>
      <button type="button" className="row picker" disabled={disabled} onClick={() => setOpen(true)}>
        <span className="row-label">{label}</span>
        <span className={`picker-value ${current ? '' : 'placeholder'}`}>
          {current ? current.label : placeholder}
          <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
        </span>
      </button>
      {open && (
        <div className="backdrop sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <h3>{label}</h3>
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

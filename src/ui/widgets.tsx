import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Editor } from '../editor/editor';
import type { Asset, Kind } from '../engine/types';

export const EdCtx = createContext<Editor>(null as any);
/** Subscribe a component to editor changes. */
export function useEd(): Editor {
  const ed = useContext(EdCtx);
  useSyncExternalStore(ed.subscribe, () => ed.version);
  return ed;
}

export function Num({ value, onChange, step = 0.1, min, max, w }: { value: number; onChange(v: number): void; step?: number; min?: number; max?: number; w?: number }) {
  const [txt, setTxt] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTxt(String(Math.round(value * 1000) / 1000)); }, [value]);
  return (
    <input className="in num" type="number" step={step} min={min} max={max} value={txt} style={w ? { width: w } : undefined}
      onFocus={() => (focused.current = true)}
      onBlur={() => { focused.current = false; setTxt(String(Math.round(value * 1000) / 1000)); }}
      onChange={(e) => {
        setTxt(e.target.value);
        let v = parseFloat(e.target.value);
        if (!Number.isFinite(v)) return;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        onChange(v);
      }} />
  );
}

export const Txt = ({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder?: string }) =>
  <input className="in" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;

export const Area = ({ value, onChange, rows = 4, placeholder }: { value: string; onChange(v: string): void; rows?: number; placeholder?: string }) =>
  <textarea className="in" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;

export const Color = ({ value, onChange }: { value: string; onChange(v: string): void }) => (
  <span className="color">
    <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
    <input className="in" value={value ?? ''} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange(e.target.value)} />
  </span>
);

export const Sel = ({ value, onChange, options }: { value: any; onChange(v: string): void; options: (readonly [string, string] | string)[] }) => (
  <select className="in" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => { const [v, l] = typeof o === 'string' ? [o, o] : o; return <option key={v} value={v}>{l}</option>; })}
  </select>
);

export const Check = ({ value, onChange, label }: { value: boolean; onChange(v: boolean): void; label?: string }) =>
  <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;

export const Slider = ({ value, onChange, min, max, step = 0.01 }: { value: number; onChange(v: number): void; min: number; max: number; step?: number }) => (
  <span className="slider">
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    <Num value={value} onChange={onChange} step={step} w={62} />
  </span>
);

export const Vec = ({ value, onChange, step = 0.1 }: { value: number[]; onChange(v: number[]): void; step?: number }) => (
  <span className="vec">{['X', 'Y', 'Z'].map((a, i) => <label key={a}><i className={'ax' + i}>{a}</i><Num value={value[i]} step={step} onChange={(v) => { const n = [...value]; n[i] = v; onChange(n); }} /></label>)}</span>
);

export const Row = ({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) =>
  <div className="row" title={tip}><span className="lbl">{label}</span><span className="val">{children}</span></div>;

export const Section = ({ title, children, open = true, extra }: { title: string; children: ReactNode; open?: boolean; extra?: ReactNode }) =>
  <details className="sec" open={open}><summary>{title}{extra}</summary><div className="secb">{children}</div></details>;

export const Btn = ({ children, onClick, tip, kind = '', disabled, active }: { children: ReactNode; onClick?(): void; tip?: string; kind?: string; disabled?: boolean; active?: boolean }) =>
  <button className={`btn ${kind} ${active ? 'on' : ''}`} title={tip} disabled={disabled} onClick={onClick}>{children}</button>;

export function AssetSel({ type, value, onChange }: { type: Asset['type'] | 'media'; value: string; onChange(v: string): void }) {
  const ed = useEd();
  const list = Object.values(ed.scene.assets).filter((a) => (type === 'media' ? a.type === 'image' || a.type === 'video' : a.type === type));
  return <Sel value={value} onChange={onChange} options={[['', list.length ? '(none)' : type === 'media' ? '(import an image, GIF or video first)' : `(import a ${type} file first)`], ...list.map((a) => [a.id, a.name] as const)]} />;
}

export function ObjSel({ value, onChange, kinds, pred }: { value: string; onChange(v: string): void; kinds?: Kind[]; pred?: (o: any) => boolean }) {
  const ed = useEd();
  const list = Object.values(ed.scene.objects).filter((o) => (!kinds || kinds.includes(o.kind)) && (!pred || pred(o)));
  return (
    <span className="objsel">
      <Sel value={value} onChange={onChange} options={[['', '(choose object)'], ...list.map((o) => [o.id, o.name] as const)]} />
      <button className="btn mini" title="Use the object selected in the scene" onClick={() => ed.selection[0] && onChange(ed.selection[0])}>⌖</button>
    </span>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose?(): void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header><h2>{title}</h2>{onClose && <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>}</header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

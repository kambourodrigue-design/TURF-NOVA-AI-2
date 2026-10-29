import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Boîtes de dialogue de l'application (remplacent alert/confirm/prompt) */
/*  Elles suivent le thème clair/sombre, contrairement aux boîtes natives. */
/* ------------------------------------------------------------------ */

type Req =
  | { kind: 'alert'; message: string; resolve: () => void }
  | { kind: 'confirm'; message: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; defaultValue: string; resolve: (v: string | null) => void };

let push: ((r: Req) => void) | null = null;

/** Message d'information (équivalent de alert). */
export const uiAlert = (message: string): Promise<void> =>
  new Promise((resolve) => {
    if (!push) { window.alert(message); resolve(); return; }
    push({ kind: 'alert', message, resolve });
  });

/** Question Oui/Non (équivalent de confirm). */
export const uiConfirm = (message: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (!push) { resolve(window.confirm(message)); return; }
    push({ kind: 'confirm', message, resolve });
  });

/** Saisie d'un texte (équivalent de prompt) ; null si annulé. */
export const uiPrompt = (message: string, defaultValue = ''): Promise<string | null> =>
  new Promise((resolve) => {
    if (!push) { resolve(window.prompt(message, defaultValue)); return; }
    push({ kind: 'prompt', message, defaultValue, resolve });
  });

export const DialogHost: React.FC = () => {
  const [queue, setQueue] = useState<Req[]>([]);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cur = queue[0];

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    return () => { push = null; };
  }, []);
  useEffect(() => {
    if (cur?.kind === 'prompt') { setText(cur.defaultValue); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [cur]);

  if (!cur) return null;
  const close = () => setQueue((q) => q.slice(1));
  const cancel = () => {
    if (cur.kind === 'confirm') cur.resolve(false);
    else if (cur.kind === 'prompt') cur.resolve(null);
    else cur.resolve();
    close();
  };
  const ok = () => {
    if (cur.kind === 'confirm') cur.resolve(true);
    else if (cur.kind === 'prompt') cur.resolve(text);
    else cur.resolve();
    close();
  };
  const btn = 'px-4 py-2.5 rounded-xl text-sm font-bold active:scale-95 transition';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" onClick={cancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white border border-stone-200 shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-stone-800 whitespace-pre-line break-words">{cur.message}</p>
        {cur.kind === 'prompt' && (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); }}
            className="mt-3 w-full px-3 py-2 rounded-xl border border-stone-300 bg-stone-50 text-sm text-stone-900"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          {cur.kind !== 'alert' && <button onClick={cancel} className={`${btn} border border-stone-300 bg-white text-stone-700`}>Annuler</button>}
          <button onClick={ok} autoFocus={cur.kind !== 'prompt'} className={`${btn} bg-emerald-800 text-white`}>OK</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/* ------------------------------------------------------------------ */
/*  Liste déroulante de l'application (remplace <Select>)              */
/*  Même utilisation que <Select> : value, onChange, <option>…         */
/* ------------------------------------------------------------------ */

const textOf = (n: React.ReactNode): string => {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (React.isValidElement(n)) return textOf((n.props as any).children);
  return '';
};

interface Opt { value: string; label: string; disabled: boolean }
const collect = (children: React.ReactNode, out: Opt[] = []): Opt[] => {
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c)) return;
    const p: any = c.props;
    if (c.type === 'option') {
      const label = textOf(p.children).replace(/\s+/g, ' ').trim();
      out.push({ value: p.value !== undefined ? String(p.value) : label, label, disabled: !!p.disabled });
    } else if (p && p.children) collect(p.children, out);
  });
  return out;
};

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({
  value, onChange, className = '', children, disabled, id, title, name,
  'aria-label': ariaLabel, ...rest
}) => {
  const [open, setOpen] = useState(false);
  const opts = collect(children);
  const cur = opts.find((o) => o.value === String(value ?? ''));
  const pick = (v: string) => {
    setOpen(false);
    onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };
  const extra: Record<string, unknown> = {};
  Object.keys(rest).forEach((k) => { if (k.startsWith('data-')) extra[k] = (rest as any)[k]; });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button" id={id} title={title} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        disabled={disabled} onClick={() => setOpen(true)} {...extra}
        className={`${className} flex items-center justify-between gap-2 text-left ${disabled ? 'opacity-60' : ''}`}
      >
        <span className="truncate min-w-0">{cur ? cur.label : (opts[0]?.label ?? '')}</span>
        <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[190] flex items-end sm:items-center justify-center bg-black/60 p-3" onClick={() => setOpen(false)}>
          <div role="listbox" className="w-full max-w-sm max-h-[75vh] overflow-y-auto rounded-2xl bg-white border border-stone-200 shadow-2xl divide-y divide-stone-100" onClick={(e) => e.stopPropagation()}>
            {opts.map((o) => {
              const sel = o.value === String(value ?? '');
              return (
                <button
                  key={o.value} type="button" role="option" aria-selected={sel} disabled={o.disabled} onClick={() => pick(o.value)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left text-[15px] ${sel ? 'bg-emerald-50 text-emerald-800 font-bold' : 'text-stone-800'} ${o.disabled ? 'opacity-40' : ''}`}
                >
                  <span className="min-w-0">{o.label}</span>
                  {sel && <Check className="w-4 h-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
